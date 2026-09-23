/**
 * 「〜で」の直前が場所を意味しない定型語のリスト（§5.4）。「候補 + で」の形で持つ。
 * 外れたケースを見つけたらテスト行と一緒に足す
 */
const LOCATION_STOP_PHRASES = [
  'みんなで',
  '皆で',
  'ひとりで',
  '一人で',
  '全員で',
  '二人で',
  '2人で',
  'ふたりで',
  '家族で',
  '有志で',
  '急ぎで',
  '無料で',
]

/** 「候補 + で」がストップリストに一致するか（§5.4 規則 L2） */
export function isLocationStopPhrase(candidateWithDe: string): boolean {
  return LOCATION_STOP_PHRASES.includes(candidateWithDe)
}
