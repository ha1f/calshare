import { html } from 'hono/html'
import type { JSX } from 'hono/jsx/jsx-runtime'
import type { HtmlEscapedString } from 'hono/utils/html'

/**
 * hono/jsx の `JSX.Element`（`HtmlEscapedString | Promise<HtmlEscapedString>`）に、
 * `condition && <X/>` のような条件付き描画やコメントのみの式が生む `boolean` / `undefined` を加えたもの。
 * グローバルな JSX 名前空間を経由せず直接参照するためここで定義する
 */
type Content = HtmlEscapedString | Promise<HtmlEscapedString> | boolean | undefined

export interface LayoutProps {
  title: string
  /** 例: `/assets/css/detail.css`。ページ固有の CSS が無ければ省略する */
  cssHref?: string
  /** 例: `/assets/js/detail.js`。まだビルドされていなければ 404 になるが、静的ページ側と同じ規約として許容する */
  scriptSrc?: string
  /** OGP の `<meta>` 等、ページ固有の追加ヘッダ要素 */
  head?: Content
  children: Content | Content[]
}

/**
 * サーバ SSR ページ（詳細・通報・404）の共通シェル。動的ルートは常に noindex にするため
 * `robots` メタは固定する（トップ・完成・履歴は静的アセット側で配信するので対象外、§9.5）
 */
export function Layout({ title, cssHref, scriptSrc, head, children }: LayoutProps): JSX.Element {
  // hono/jsx は <html> を描画しても DOCTYPE を付けないため、html タグでリテラルとして先頭に足す
  return html`<!DOCTYPE html>${(
      <html lang="ja">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta name="robots" content="noindex, nofollow" />
          <title>{title}</title>
          <link rel="stylesheet" href="/assets/css/base.css" />
          {cssHref && <link rel="stylesheet" href={cssHref} />}
          {head}
        </head>
        <body>
          {children}
          {scriptSrc && <script type="module" src={scriptSrc}></script>}
        </body>
      </html>
    )}`
}
