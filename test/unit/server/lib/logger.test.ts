import { describe, expect, it, vi } from 'vitest'
import {
  logRequestCompleted,
  logUnhandledError,
  resolveLoggablePageId,
} from '../../../../src/server/lib/logger'
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

describe('resolveLoggablePageId', () => {
  it('12 文字の有効な ID をそのまま返す', () => {
    expect(resolveLoggablePageId('aaaaaaaaaaaa')).toBe('aaaaaaaaaaaa')
  })

  it('末尾の .ics を除いて判定する', () => {
    expect(resolveLoggablePageId('aaaaaaaaaaaa.ics')).toBe('aaaaaaaaaaaa')
  })

  it('undefined はそのまま undefined にする', () => {
    expect(resolveLoggablePageId(undefined)).toBeUndefined()
  })

  it('12 文字でない文字列は undefined にする', () => {
    expect(resolveLoggablePageId('a'.repeat(11))).toBeUndefined()
    expect(resolveLoggablePageId('a'.repeat(13))).toBeUndefined()
    expect(resolveLoggablePageId('x'.repeat(5000))).toBeUndefined()
  })

  it('Crockford Base32 に無い文字（大文字・i/l/o/u）を含む文字列は undefined にする', () => {
    expect(resolveLoggablePageId('AAAAAAAAAAAA')).toBeUndefined()
    expect(resolveLoggablePageId('aaaaaaaaaaai')).toBeUndefined()
  })

  it('拡張子を除いても長さが合わない文字列は undefined にする（.ics.ics など）', () => {
    expect(resolveLoggablePageId('aaaaaaaaaaaa.ics.ics')).toBeUndefined()
  })

  it('制御文字やエンコード由来の記号を含む文字列は undefined にする', () => {
    expect(resolveLoggablePageId('%0A%FF%3Cscript>LEAK')).toBeUndefined()
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
