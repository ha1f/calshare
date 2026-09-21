import { describe, expect, it } from 'vitest'
import { jstDate } from '../../../../src/core/time/jst'
import { parseEventText } from '../../../../src/core/parse/parseEventText'

const NOW = jstDate(2026, 9, 16, 10, 0)

// 正規表現がバックトラック爆発を起こさず線形時間で終わることの確認（§5.1 の実装規約）
describe('parseEventText: 長い入力での性能', () => {
  it.each([
    ['9/ を 1000 回繰り返す', '9/'.repeat(1000)],
    ['〜 を 2000 回繰り返す', '〜'.repeat(2000)],
    ['http:// を 200 回繰り返す', 'http://'.repeat(200)],
  ])('%s（2,000 文字前後）が 50ms 以内に返る', (_label, repeated) => {
    const input = repeated.slice(0, 2000)
    const start = performance.now()
    parseEventText(input, { now: NOW })
    expect(performance.now() - start).toBeLessThan(50)
  })
})
