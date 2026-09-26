import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildDeps } from '../../../src/server/deps'
import type { Env } from '../../../src/server/env'

// DB / BUCKET は各アダプタの生成時には読まれず、メソッド呼び出し時に初めて使う。
// ASSETS も buildDeps 内では読まないので、いずれも空オブジェクトで足りる
function testEnv(overrides: Partial<Env>): Env {
  return {
    DB: {},
    BUCKET: {},
    ASSETS: {},
    PUBLIC_ORIGIN: 'http://localhost:8787',
    SERVICE_NAME: 'calshare',
    RATE_LIMIT_PEPPER: 'test-pepper',
    ...overrides,
  } as unknown as Env
}

describe('buildDeps / buildClock', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('E2E_FIXED_NOW が無ければ現在時刻を返す clock になる', () => {
    const before = Date.now()
    const deps = buildDeps(testEnv({}))
    const now = deps.clock.now().getTime()
    expect(now).toBeGreaterThanOrEqual(before)
    expect(now).toBeLessThanOrEqual(Date.now())
  })

  it('localhost かつ E2E_FIXED_NOW があれば固定時刻になる', () => {
    const deps = buildDeps(
      testEnv({ PUBLIC_ORIGIN: 'http://localhost:8787', E2E_FIXED_NOW: '2026-09-16T01:00:00Z' }),
    )
    expect(deps.clock.now().toISOString()).toBe('2026-09-16T01:00:00.000Z')
  })

  it('localhost 以外なら E2E_FIXED_NOW を無視して warn する', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const deps = buildDeps(
      testEnv({ PUBLIC_ORIGIN: 'https://example.com', E2E_FIXED_NOW: '2026-09-16T01:00:00Z' }),
    )

    expect(deps.clock.now().toISOString()).not.toBe('2026-09-16T01:00:00.000Z')
    expect(logSpy).toHaveBeenCalledOnce()
    const payload = JSON.parse(logSpy.mock.calls[0][0] as string)
    expect(payload).toMatchObject({ level: 'warn', event: 'e2e_fixed_now_ignored' })
  })

  it('localhost で E2E_FIXED_NOW が不正な文字列なら warn して現在時刻の clock になる', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const before = Date.now()
    const deps = buildDeps(
      testEnv({ PUBLIC_ORIGIN: 'http://localhost:8787', E2E_FIXED_NOW: 'not-a-date' }),
    )
    const now = deps.clock.now().getTime()

    expect(now).toBeGreaterThanOrEqual(before)
    expect(now).toBeLessThanOrEqual(Date.now())
    expect(logSpy).toHaveBeenCalledOnce()
    const payload = JSON.parse(logSpy.mock.calls[0][0] as string)
    expect(payload).toMatchObject({ level: 'warn', event: 'e2e_fixed_now_invalid' })
  })

  it('config.publicHost は PUBLIC_ORIGIN のホスト（ポート込み）になる', () => {
    const deps = buildDeps(testEnv({ PUBLIC_ORIGIN: 'http://localhost:8787' }))
    expect(deps.config.publicHost).toBe('localhost:8787')
  })

  it('PUBLIC_ORIGIN の末尾にスラッシュが付いていても config.publicOrigin には残らない', () => {
    const deps = buildDeps(testEnv({ PUBLIC_ORIGIN: 'http://localhost:8787/' }))
    expect(deps.config.publicOrigin).toBe('http://localhost:8787')
    expect(deps.config.publicHost).toBe('localhost:8787')
  })
})
