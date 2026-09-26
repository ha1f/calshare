// innerHTML を使わず DOM を組み立てるための薄いヘルパー（§9.1）。

/**
 * 静的 HTML に必ずある前提の要素を id で取得する。無ければ静的 HTML と JS がずれているバグなので
 * その場で例外にする（各画面の main() が想定していない `undefined` のまま処理を進めるのを防ぐ）
 */
export function requireElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id)
  if (el === null) throw new Error(`#${id} is missing`)
  return el as T
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
