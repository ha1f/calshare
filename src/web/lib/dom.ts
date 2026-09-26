// innerHTML を使わず DOM を組み立てるための薄いヘルパー（§9.1）。

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
