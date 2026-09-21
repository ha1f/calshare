import { describe, expect, it } from 'vitest'
import { buildDeviceCookie, readDeviceId } from '../../../../src/server/lib/deviceCookie'

const VALID_ID = '550e8400-e29b-41d4-a716-446655440000'

describe('readDeviceId', () => {
  it('cs_device だけの Cookie ヘッダから値を読める', () => {
    const request = new Request('http://localhost/', {
      headers: { Cookie: `cs_device=${VALID_ID}` },
    })

    expect(readDeviceId(request)).toBe(VALID_ID)
  })

  it('他の Cookie に混ざっていても読める', () => {
    const request = new Request('http://localhost/', {
      headers: { Cookie: `foo=bar; cs_device=${VALID_ID}; baz=qux` },
    })

    expect(readDeviceId(request)).toBe(VALID_ID)
  })

  it('引用符付きでも読める', () => {
    const request = new Request('http://localhost/', {
      headers: { Cookie: `cs_device="${VALID_ID}"` },
    })

    expect(readDeviceId(request)).toBe(VALID_ID)
  })

  it('Cookie ヘッダが無ければ null', () => {
    const request = new Request('http://localhost/')

    expect(readDeviceId(request)).toBeNull()
  })

  it('cs_device が無ければ null', () => {
    const request = new Request('http://localhost/', { headers: { Cookie: 'foo=bar' } })

    expect(readDeviceId(request)).toBeNull()
  })

  it('空文字なら null（再発行させる）', () => {
    const request = new Request('http://localhost/', { headers: { Cookie: 'cs_device=' } })

    expect(readDeviceId(request)).toBeNull()
  })

  it('UUID 形式でなければ null', () => {
    const request = new Request('http://localhost/', { headers: { Cookie: 'cs_device=abc123' } })

    expect(readDeviceId(request)).toBeNull()
  })

  it('巨大な値は null（bucket_key に無制限の長さを持ち込ませない）', () => {
    const huge = 'x'.repeat(100000)
    const request = new Request('http://localhost/', { headers: { Cookie: `cs_device=${huge}` } })

    expect(readDeviceId(request)).toBeNull()
  })

  it('制御文字を含む値は null', () => {
    const request = new Request('http://localhost/', {
      headers: { Cookie: 'cs_device=a%3Bb%0D%0Aip%3Ax' },
    })

    expect(readDeviceId(request)).toBeNull()
  })
})

describe('buildDeviceCookie', () => {
  it('設計どおりの属性を持つ Set-Cookie 値を作る', () => {
    const cookie = buildDeviceCookie(VALID_ID)

    expect(cookie).toContain(`cs_device=${VALID_ID}`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Max-Age=34560000')
    expect(cookie).toContain('Path=/')
  })
})
