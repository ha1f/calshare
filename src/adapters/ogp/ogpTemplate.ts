import type { OgpInput } from '../../ports/ogpRenderer'

/**
 * satori に渡す要素ツリーのノード形状。satori は React ではなくこの素のオブジェクト形状を要求する
 * （hono/jsx の JSXNode はそのまま渡せない、design.md §2.5）。
 */
interface SatoriNode {
  type: string
  props: {
    style?: Record<string, string | number>
    children?: SatoriNode[] | string
  }
}

function node(
  type: string,
  style: Record<string, string | number>,
  children?: SatoriNode[] | string,
): SatoriNode {
  return { type, props: { style, children } }
}

/** ユーザー入力はテキストノードの中身としてのみ渡す。文字列連結で SVG/HTML を組み立てない（§2.5） */
function text(value: string, style: Record<string, string | number> = {}): SatoriNode {
  return node('div', style, value)
}

const CARD_BACKGROUND = '#0f172a'
const ACCENT_COLOR = '#38bdf8'
const TEXT_COLOR = '#f8fafc'
const MUTED_COLOR = '#94a3b8'

/**
 * OGP 画像のレイアウト（design.md §14.2 で仮とされている。配色・寸法は今後オーナー判断で変わりうる）。
 * 固定文言「予定の共有」とサービス名は、なりすまし対策として常に描画する（§2.5）。
 */
export function ogpTemplate(input: OgpInput): SatoriNode {
  const children: SatoriNode[] = [
    // 中黒は半角の "·"（U+00B7）ではなく全角の "・"（U+30FB）を使う。
    // サブセットフォント（scripts/fonts/subset.sh）に含まれるのは後者だけ
    text(`予定の共有・${input.serviceName}`, {
      fontSize: 28,
      color: ACCENT_COLOR,
      display: 'block',
    }),
  ]

  if (input.title !== '') {
    children.push(
      node(
        'div',
        {
          display: '-webkit-box',
          WebkitBoxOrient: 'vertical',
          WebkitLineClamp: '2',
          overflow: 'hidden',
          fontSize: 64,
          fontWeight: 700,
          color: TEXT_COLOR,
          marginTop: 32,
          lineHeight: 1.3,
        },
        input.title,
      ),
    )
  }

  children.push(
    text(input.dateLabel, {
      fontSize: 36,
      color: TEXT_COLOR,
      marginTop: 32,
      display: 'block',
    }),
  )

  if (input.location !== null && input.location !== '') {
    children.push(
      node('div', { display: 'flex', flexDirection: 'row', marginTop: 16 }, [
        text('場所: ', { fontSize: 28, color: MUTED_COLOR }),
        text(input.location, { fontSize: 28, color: MUTED_COLOR }),
      ]),
    )
  }

  return node(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      height: '100%',
      backgroundColor: CARD_BACKGROUND,
      padding: 64,
      fontFamily: 'Noto Sans JP',
    },
    children,
  )
}
