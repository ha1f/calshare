export interface ShareData {
  title: string
  url: string
}

/** `navigator.share` が使える環境かどうか（フィーチャー検出、§6.2）。無い環境ではボタンごと出さない */
export function canShare(): boolean {
  return typeof navigator.share === 'function'
}

/**
 * OS の共有シートを開く。呼び出し元は結果を待たずに呼ぶため、キャンセル（`AbortError`）に限らず
 * どんな失敗も画面に伝える手段が無い。投げ直しても受け手が無く未処理の Promise 拒否になるだけなので、
 * ここで黙って無視する
 */
export async function shareUrl(data: ShareData): Promise<void> {
  try {
    await navigator.share(data)
  } catch {
    // 失敗しても何もしない
  }
}
