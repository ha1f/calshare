/**
 * 2 つのハッシュ値を定数時間で比較する。タイミング攻撃で正解のハッシュを 1 バイトずつ
 * 推測されないよう、不一致を見つけても最後まで全バイトを比較する（§3.3）
 */
export function verifyEditTokenHash(actual: string, expected: string): boolean {
  if (actual.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < actual.length; i++) {
    diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return diff === 0
}
