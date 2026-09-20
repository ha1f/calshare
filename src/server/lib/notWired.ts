/** どのメソッドを呼んでも Error(`not wired: ${name}`) を投げる Proxy。Deps の型を満たしたまま、本物の実装が無いことを呼び出し時にわかるようにする */
export function notWired<T extends object>(name: string): T {
  return new Proxy({} as T, {
    get() {
      throw new Error(`not wired: ${name}`)
    },
  })
}
