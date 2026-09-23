import { sameDateTime } from '../validate/validateEventFields'
import type { ChangeSnapshot, EventFields } from '../types'

/** null と空文字、前後の空白は同一視する（§3.5）。編集画面が空欄を '' で送っても変更扱いにしないため */
function sameText(a: string | null, b: string | null): boolean {
  return (a ?? '').trim() === (b ?? '').trim()
}

/**
 * 編集前後を比べ、タイトル・日時・場所のいずれかが変わっていれば変更前の日時 +
 * titleChanged / locationChanged を返す。メモだけの変更は null（§3.5）
 */
export function buildChangeSnapshot(
  previous: EventFields,
  next: EventFields,
): ChangeSnapshot | null {
  const titleChanged = !sameText(previous.title, next.title)
  const locationChanged = !sameText(previous.location, next.location)
  if (!titleChanged && !locationChanged && sameDateTime(previous, next)) return null

  return {
    start: previous.start,
    end: previous.end,
    isAllDay: previous.isAllDay,
    titleChanged,
    locationChanged,
  }
}
