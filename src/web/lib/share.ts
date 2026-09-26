export interface ShareData {
  title: string
  url: string
}

/** `navigator.share` が使える環境かどうか（フィーチャー検出、§6.2）。無い環境ではボタンごと出さない */
export function canShare(): boolean {
  return typeof navigator.share === 'function'
}

/** OS の共有シートを開く。ユーザーがキャンセルすると `AbortError` が投げられるので黙って無視する */
export async function shareUrl(data: ShareData): Promise<void> {
  try {
    await navigator.share(data)
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return
    throw error
  }
}
