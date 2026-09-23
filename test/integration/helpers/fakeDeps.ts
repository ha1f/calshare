import { fakeClock } from '../../../src/adapters/clock/fakeClock'
import { createFakeIdGenerator } from '../../../src/adapters/id/fakeIdGenerator'
import { createMemoryObjectStorage } from '../../../src/adapters/memory/memoryObjectStorage'
import { createMemoryPageRepository } from '../../../src/adapters/memory/memoryPageRepository'
import { createMemoryRateLimiter } from '../../../src/adapters/memory/memoryRateLimiter'
import { createMemoryReportRepository } from '../../../src/adapters/memory/memoryReportRepository'
import { createFakeNotifier } from '../../../src/adapters/notifier/fakeNotifier'
import { createFakeOgpRenderer } from '../../../src/adapters/ogp/fakeOgpRenderer'
import type { Logger } from '../../../src/ports/logger'
import type { Deps } from '../../../src/server/deps'
import { TEST_ORIGIN } from './jsonRequest'

/** 何も出力しない Logger。warn/error を経由するテストで結合テストの出力を汚さないための Fake */
export const silentLogger: Logger = {
  info() {},
  warn() {},
  error() {},
}

/**
 * ルートの結合テストで使う Deps。時刻・ID・D1・R2・レート制限のすべてを Fake（memory 実装）に差し替える
 * （§10.2「差し替えは createApp(deps) の引数で行う」）。SELF.fetch を使うテストは本物の buildDeps を使う
 */
export function buildFakeDeps(overrides: Partial<Deps> = {}): Deps {
  const clock = fakeClock(new Date('2026-09-16T01:00:00.000Z'))
  return {
    clock,
    ids: createFakeIdGenerator(),
    pages: createMemoryPageRepository(),
    reports: createMemoryReportRepository(),
    storage: createMemoryObjectStorage(clock),
    rateLimiter: createMemoryRateLimiter(),
    ogpRenderer: createFakeOgpRenderer(),
    notifier: createFakeNotifier(),
    logger: silentLogger,
    config: {
      publicOrigin: TEST_ORIGIN,
      publicHost: new URL(TEST_ORIGIN).host,
      serviceName: 'calshare',
      ratePepper: 'test-pepper',
    },
    ...overrides,
  }
}
