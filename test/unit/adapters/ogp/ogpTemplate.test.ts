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

  it('場所の値ノードはタイトルと同じく 2 行で clamp され、ラベルは縮まない', () => {
    const root = ogpTemplate(baseInput()) as unknown as {
      props: {
        children: Array<{
          type: string
          props: { children: unknown; style?: Record<string, unknown> }
        }>
      }
    }
    const locationRow = root.props.children.find(
      (child) => child.type === 'div' && Array.isArray(child.props.children),
    )
    const [label, value] = locationRow?.props.children as Array<{
      props: { style?: Record<string, unknown> }
    }>

    expect(label.props.style).toMatchObject({ flexShrink: 0 })
    expect(value.props.style).toMatchObject({
      display: '-webkit-box',
      WebkitBoxOrient: 'vertical',
      WebkitLineClamp: '2',
      // satori は textOverflow: 'ellipsis' と組み合わせないと WebkitLineClamp が行数を
      // 制限しない（node_modules/satori/dist/standalone.js の行数計算処理で確認済み）
      textOverflow: 'ellipsis',
      overflow: 'hidden',
      wordBreak: 'break-all',
    })
  })

  it('タイトルのノードも場所と同じ行数制限のスタイル一式を持つ', () => {
    const root = ogpTemplate(baseInput()) as unknown as {
      props: { children: Array<{ props: { children: unknown; style?: Record<string, unknown> } }> }
    }
    const titleNode = root.props.children.find((child) => child.props.children === '飲み会')

    expect(titleNode?.props.style).toMatchObject({
      display: '-webkit-box',
      WebkitBoxOrient: 'vertical',
      WebkitLineClamp: '2',
      textOverflow: 'ellipsis',
      overflow: 'hidden',
      wordBreak: 'break-all',
    })
  })
})
