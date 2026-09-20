import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { consoleLogger } from '../../../../src/adapters/logger/consoleLogger'

describe('consoleLogger', () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
  })

  function loggedPayload(): Record<string, unknown> {
    expect(logSpy).toHaveBeenCalledOnce()
    return JSON.parse(logSpy.mock.calls[0][0] as string)
  }

  it('Error を { name, message } に正規化する', () => {
    consoleLogger.error('page_create_failed', { error: new TypeError('boom'), pageId: 'abc' })

    const payload = loggedPayload()
    expect(payload).toMatchObject({
      level: 'error',
      event: 'page_create_failed',
      pageId: 'abc',
      error: { name: 'TypeError', message: 'boom' },
    })
  })

  it('Error の message を 200 文字で切り詰める', () => {
    const longMessage = 'x'.repeat(300)
    consoleLogger.error('page_create_failed', { error: new Error(longMessage) })

    const payload = loggedPayload()
    expect((payload.error as { message: string }).message).toHaveLength(200)
  })

  it('Error 以外の error 値は捨てる', () => {
    consoleLogger.warn('unexpected', { error: 'raw string is not allowed', route: '/api/pages' })

    const payload = loggedPayload()
    expect(payload).not.toHaveProperty('error')
    expect(payload).toMatchObject({ level: 'warn', event: 'unexpected', route: '/api/pages' })
  })

  it('data が無くても動く', () => {
    consoleLogger.info('server_started')

    const payload = loggedPayload()
    expect(payload).toEqual({ level: 'info', event: 'server_started' })
  })

  it('data に level / event というキーがあっても固定フィールドを上書きしない', () => {
    consoleLogger.info('server_started', { level: 'fake', event: 'fake' })

    const payload = loggedPayload()
    expect(payload).toEqual({ level: 'info', event: 'server_started' })
  })
})
