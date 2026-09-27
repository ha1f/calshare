/**
 * 添字アクセスの結果が undefined でないことを、呼び出し側が把握している不変条件のもとで確定させる。
 * 条件が崩れていた場合は、undefined のまま黙って計算を続けず例外にする。
 */
export function requireDefined<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new Error(message)
  }
  return value
}
