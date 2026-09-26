import { describe, expect, it, vi } from 'vitest'
import { logRequestCompleted, logUnhandledError } from '../../../../src/server/lib/logger'
import type { Logger } from '../../../../src/ports/logger'

function fakeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

describe('logRequestCompleted', () => {
  it('ルート名・メソッド・ステータス・所要時間・pageId を info ログに載せる', () => {
    const logger = fakeLogger()

    logRequestCompleted(logger, {
      route: '/:id',
      method: 'GET',
      status: 200,
      durationMs: 12,
      pageId: 'abc123',
    })

    expect(logger.info).toHaveBeenCalledWith('request_completed', {
      route: '/:id',
      method: 'GET',
      status: 200,
      durationMs: 12,
      pageId: 'abc123',
    })
  })

  it('pageId が無いルートでは undefined のまま渡す（クエリ文字列や本文は受け取らない）', () => {
    const logger = fakeLogger()

    logRequestCompleted(logger, {
      route: '/api/health',
      method: 'GET',
      status: 200,
      durationMs: 1,
    })

    expect(logger.info).toHaveBeenCalledWith(
      'request_completed',
      expect.objectContaining({ route: '/api/health', pageId: undefined }),
    )
  })
})

describe('logUnhandledError', () => {
  it('route・pageId・error を error ログに載せる（正規化は Logger 実装側の責務）', () => {
    const logger = fakeLogger()
    const error = new Error('boom')

    logUnhandledError(logger, { route: '/:id', pageId: 'abc123' }, error)

    expect(logger.error).toHaveBeenCalledWith('unhandled_error', {
      route: '/:id',
      pageId: 'abc123',
      error,
    })
  })
})
