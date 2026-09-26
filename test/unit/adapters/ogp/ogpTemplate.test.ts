import { describe, expect, it } from 'vitest'
import { ogpTemplate } from '../../../../src/adapters/ogp/ogpTemplate'
import type { OgpInput } from '../../../../src/ports/ogpRenderer'

/** ogpTemplate が返す素のオブジェクトツリーからテキストノードの中身だけを集める */
function collectText(node: unknown): string[] {
  if (typeof node === 'string') return [node]
  if (Array.isArray(node)) return node.flatMap(collectText)
  if (node !== null && typeof node === 'object' && 'props' in node) {
    return collectText((node as { props: { children?: unknown } }).props.children)
  }
  return []
}

function baseInput(overrides: Partial<OgpInput> = {}): OgpInput {
  return {
    title: '飲み会',
    dateLabel: '9月20日(日) 19:00〜21:00',
    location: '渋谷',
    serviceName: 'calshare',
    ...overrides,
  }
}

describe('ogpTemplate', () => {
  it('固定文言「予定の共有」とサービス名を必ず含める（なりすまし対策、§2.5）', () => {
    const text = collectText(ogpTemplate(baseInput())).join('\n')
    expect(text).toContain('予定の共有')
    expect(text).toContain('calshare')
  })

  it('title が空文字でも固定文言とサービス名は描く', () => {
    const text = collectText(ogpTemplate(baseInput({ title: '' }))).join('\n')
    expect(text).toContain('予定の共有')
    expect(text).toContain('calshare')
    expect(text).not.toContain('飲み会')
  })

  it('title・dateLabel・location をそれぞれ含む', () => {
    const text = collectText(ogpTemplate(baseInput())).join('\n')
    expect(text).toContain('飲み会')
    expect(text).toContain('9月20日(日) 19:00〜21:00')
    expect(text).toContain('渋谷')
  })

  it('location が null なら場所の行を含まない', () => {
    const text = collectText(ogpTemplate(baseInput({ location: null }))).join('\n')
    expect(text).not.toContain('場所')
  })
})
