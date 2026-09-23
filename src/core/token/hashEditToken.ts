/** 編集トークンを SHA-256（hex）に変換する。生トークンは保存せず、この結果だけを保存する（§3.3） */
export async function hashEditToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
