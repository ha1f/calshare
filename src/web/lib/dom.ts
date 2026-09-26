// innerHTML を使わず DOM を組み立てるための薄いヘルパー（§9.1）。

/**
 * 静的 HTML に必ずある前提の要素を id で取得する。無ければ、または `ctor` の型と違えば
 * 静的 HTML と JS がずれているバグなのでその場で例外にする（各画面の main() が想定しない要素の
 * まま処理を進め、後続の代入やプロパティアクセスが黙って意味を失うのを防ぐ）
 */
export function requireElement<T extends HTMLElement>(
  id: string,
  ctor: new () => T = HTMLElement as new () => T,
): T {
  const el = document.getElementById(id)
  if (el === null) throw new Error(`#${id} is missing`)
  if (!(el instanceof ctor)) throw new Error(`#${id} is not a ${ctor.name}`)
  return el
}

/**
 * 内容に応じてテキストエリアの高さを伸ばす（§6.1「自動リサイズの textarea」）。
 * 一度 `auto` に縮めてから `scrollHeight` に合わせないと、行を消したときに縮まない
 */
export function autoResizeTextarea(textarea: HTMLTextAreaElement): void {
  textarea.style.height = 'auto'
  // box-sizing: border-box では height が border 込みの外寸になる一方、scrollHeight は border を
  // 含まないため、border 分を足さないと内容がちょうど border の幅だけはみ出してスクロールする
  const borderHeight = textarea.offsetHeight - textarea.clientHeight
  textarea.style.height = `${textarea.scrollHeight + borderHeight}px`
}

interface ElementOptions {
  className?: string
  text?: string
  attrs?: Record<string, string>
}

export function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (options.className !== undefined) node.className = options.className
  if (options.text !== undefined) node.textContent = options.text
  if (options.attrs !== undefined) {
    for (const [name, value] of Object.entries(options.attrs)) node.setAttribute(name, value)
  }
  return node
}
