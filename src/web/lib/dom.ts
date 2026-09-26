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
