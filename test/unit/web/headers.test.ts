/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest'
import headersText from '../../../src/web/_headers?raw'

function headerValueFor(path: string, headerName: string): string | undefined {
  const lines = headersText.split('\n')
  const pathIndex = lines.findIndex((line) => line.trim() === path)
  if (pathIndex === -1) return undefined
  for (let i = pathIndex + 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line.startsWith('  ') && !line.startsWith('\t')) break // 次のパスブロックに入った
    const [name, ...rest] = line.trim().split(':')
    if (name === headerName) return rest.join(':').trim()
  }
  return undefined
}

describe('src/web/_headers', () => {
  it('全パスに CSP・X-Content-Type-Options・Referrer-Policy が載っている', () => {
    expect(headerValueFor('/*', 'Content-Security-Policy')).toContain("default-src 'self'")
    expect(headerValueFor('/*', 'Content-Security-Policy')).toContain(
      "require-trusted-types-for 'script'",
    )
    expect(headerValueFor('/*', 'X-Content-Type-Options')).toBe('nosniff')
    expect(headerValueFor('/*', 'Referrer-Policy')).toBe('no-referrer')
  })

  it.each(['/done', '/history', '/edit'])(
    '%s に X-Robots-Tag: noindex, nofollow が載っている',
    (path) => {
      expect(headerValueFor(path, 'X-Robots-Tag')).toBe('noindex, nofollow')
    },
  )

  it('/assets/* にキャッシュ用の Cache-Control が載っている', () => {
    expect(headerValueFor('/assets/*', 'Cache-Control')).toBe('public, max-age=300')
  })
})
