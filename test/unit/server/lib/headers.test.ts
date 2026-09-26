/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest'
import headersText from '../../../../src/web/_headers?raw'
import {
  CONTENT_SECURITY_POLICY,
  REFERRER_POLICY,
  X_CONTENT_TYPE_OPTIONS,
} from '../../../../src/server/lib/headers'

// test/unit/web/headers.test.ts と同じ読み方をする（§9.1）
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

describe('src/web/_headers と src/server/lib/headers.ts の一致（§9.1）', () => {
  it('Content-Security-Policy が一致する', () => {
    expect(headerValueFor('/*', 'Content-Security-Policy')).toBe(CONTENT_SECURITY_POLICY)
  })

  it('X-Content-Type-Options が一致する', () => {
    expect(headerValueFor('/*', 'X-Content-Type-Options')).toBe(X_CONTENT_TYPE_OPTIONS)
  })

  it('Referrer-Policy が一致する', () => {
    expect(headerValueFor('/*', 'Referrer-Policy')).toBe(REFERRER_POLICY)
  })
})
