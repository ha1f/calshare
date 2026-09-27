import { fakeClock } from '../../../src/adapters/clock/fakeClock'
import { createFakeIdGenerator } from '../../../src/adapters/id/fakeIdGenerator'
import { createMemoryObjectStorage } from '../../../src/adapters/memory/memoryObjectStorage'
import {
  createMemoryPageRepository,
  createMemoryPageStore,
} from '../../../src/adapters/memory/memoryPageRepository'
import { createMemoryRateLimiter } from '../../../src/adapters/memory/memoryRateLimiter'
import { createMemoryReportRepository } from '../../../src/adapters/memory/memoryReportRepository'
import { createFakeNotifier } from '../../../src/adapters/notifier/fakeNotifier'
import { createFakeOgpRenderer } from '../../../src/adapters/ogp/fakeOgpRenderer'
import type { Logger } from '../../../src/ports/logger'
import type { Deps } from '../../../src/server/deps'
import { TEST_ORIGIN } from './jsonRequest'

/**
 * ルートの結合テストで使う Deps。時刻・ID・D1・R2・レート制限のすべてを Fake（memory 実装）に差し替える
 * （§10.2「差し替えは createApp(deps) の引数で行う」）。exports.default.fetch を使うテストは本物の buildDeps を使う。
 * logger は呼び出しごとに新しく作る。1 個を使い回すと vi.spyOn の呼び出し回数が他のテストと混ざる
 */
export function buildFakeDeps(overrides: Partial<Deps> = {}): Deps {
  const clock = fakeClock(new Date('2026-09-16T01:00:00.000Z'))
  const logger: Logger = { info() {}, warn() {}, error() {} }
  // report_count の加算は reports 側が行うので、pages と reports で同じ store を共有する（本物の D1 が 1 つの db を指すのと同じ）
  const pageStore = createMemoryPageStore()
  return {
    clock,
    ids: createFakeIdGenerator(),
    pages: createMemoryPageRepository(pageStore),
    reports: createMemoryReportRepository(pageStore),
    storage: createMemoryObjectStorage(clock),
    rateLimiter: createMemoryRateLimiter(),
    ogpRenderer: createFakeOgpRenderer(),
    notifier: createFakeNotifier(),
    logger,
    config: {
      publicOrigin: TEST_ORIGIN,
      publicHost: new URL(TEST_ORIGIN).host,
      serviceName: 'calshare',
      ratePepper: 'test-pepper',
    },
    ...overrides,
  }
}
