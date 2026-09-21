import { describe, expect, it } from 'vitest'
import { buildDeviceCookie, readDeviceId } from '../../../../src/server/lib/deviceCookie'

describe('readDeviceId', () => {
  it('cs_device だけの Cookie ヘッダから値を読める', () => {
    const request = new Request('http://localhost/', { headers: { Cookie: 'cs_device=abc123' } })

    expect(readDeviceId(request)).toBe('abc123')
  })

  it('他の Cookie に混ざっていても読める', () => {
    const request = new Request('http://localhost/', {
      headers: { Cookie: 'foo=bar; cs_device=abc123; baz=qux' },
    })

    expect(readDeviceId(request)).toBe('abc123')
  })

  it('Cookie ヘッダが無ければ null', () => {
    const request = new Request('http://localhost/')

    expect(readDeviceId(request)).toBeNull()
  })

  it('cs_device が無ければ null', () => {
    const request = new Request('http://localhost/', { headers: { Cookie: 'foo=bar' } })

    expect(readDeviceId(request)).toBeNull()
  })
})

describe('buildDeviceCookie', () => {
  it('設計どおりの属性を持つ Set-Cookie 値を作る', () => {
    const cookie = buildDeviceCookie('abc123')

    expect(cookie).toContain('cs_device=abc123')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Max-Age=34560000')
    expect(cookie).toContain('Path=/')
  })
})
