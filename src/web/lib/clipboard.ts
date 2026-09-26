/**
 * URL 等をクリップボードへコピーする（§6.2）。`navigator.clipboard` が使えない、または失敗する環境
 * （LINE 内蔵ブラウザ等）では非表示 `<textarea>` + `document.execCommand('copy')` にフォールバックする
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText !== undefined) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // フォールバックへ進む
    }
  }
  return copyWithExecCommand(text)
}

function copyWithExecCommand(text: string): boolean {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  let succeeded: boolean
  try {
    succeeded = document.execCommand('copy')
  } catch {
    succeeded = false
  }
  document.body.removeChild(textarea)
  return succeeded
}
