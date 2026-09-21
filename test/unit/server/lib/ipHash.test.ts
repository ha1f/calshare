import { describe, expect, it } from 'vitest'
import { ipHash } from '../../../../src/server/lib/ipHash'

const PEPPER = 'test-pepper'

describe('ipHash', () => {
  it('同じ IP・同じ pepper なら常に同じ値を返す', async () => {
    const first = await ipHash('203.0.113.1', PEPPER)
    const second = await ipHash('203.0.113.1', PEPPER)

    expect(first).toBe(second)
    expect(first).toMatch(/^[0-9a-f]{32}$/)
  })

  it('pepper が違えば値も変わる', async () => {
    const first = await ipHash('203.0.113.1', PEPPER)
    const second = await ipHash('203.0.113.1', 'other-pepper')

    expect(first).not.toBe(second)
  })

  it('IP が違えば値も変わる', async () => {
    const first = await ipHash('203.0.113.1', PEPPER)
    const second = await ipHash('203.0.113.2', PEPPER)

    expect(first).not.toBe(second)
  })

  it('IP が無ければ unknown を返す', async () => {
    expect(await ipHash(null, PEPPER)).toBe('unknown')
  })

  it('空文字も unknown を返す', async () => {
    expect(await ipHash('', PEPPER)).toBe('unknown')
  })

  describe('IPv6 は /64 に丸める', () => {
    it('同一 /64 内の異なる IPv6 は同じ値になる', async () => {
      const first = await ipHash('2402:6b0:1234:5678:1111:2222:3333:4444', PEPPER)
      const second = await ipHash('2402:6b0:1234:5678:aaaa:bbbb:cccc:dddd', PEPPER)

      expect(first).toBe(second)
    })

    it('別の /64 は異なる値になる', async () => {
      const first = await ipHash('2402:6b0:1234:5678::1', PEPPER)
      const second = await ipHash('2402:6b0:1234:9999::1', PEPPER)

      expect(first).not.toBe(second)
    })

    it('圧縮表記と完全展開表記で同じ /64 なら同じ値になる', async () => {
      const compressed = await ipHash('2402:6b0::1', PEPPER)
      const expanded = await ipHash('2402:06b0:0000:0000:0000:0000:0000:0001', PEPPER)

      expect(compressed).toBe(expanded)
    })
  })

  describe('IPv4-mapped IPv6', () => {
    it('::ffff:1.2.3.4 は 1.2.3.4 と同じ値になる', async () => {
      const mapped = await ipHash('::ffff:1.2.3.4', PEPPER)
      const plain = await ipHash('1.2.3.4', PEPPER)

      expect(mapped).toBe(plain)
    })

    it('完全展開表記の IPv4-mapped も同じ値になる', async () => {
      const mapped = await ipHash('0000:0000:0000:0000:0000:ffff:0102:0304', PEPPER)
      const plain = await ipHash('1.2.3.4', PEPPER)

      expect(mapped).toBe(plain)
    })
  })
})
