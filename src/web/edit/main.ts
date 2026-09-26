import type { ApiErrorCode } from '../../core/api/types'
import { PREVIEW_DEBOUNCE_MS } from '../../core/config/limits'
import { isValidPageId } from '../../core/id/crockford'
import { fromEventFieldsJson, toEventFieldsJson } from '../../core/types'
import type { EventFields, ValidationErrorCode } from '../../core/types'
import { validateEventFields } from '../../core/validate/validateEventFields'
import { ApiRequestFailedError, getPage, updatePage } from '../lib/api'
import { requireElement } from '../lib/dom'
import { readHistory, updateHistoryEntry } from '../lib/history'
import { createInitialState, effectiveFields, interpret, type CreateState } from '../create/preview'
import { createPreviewView } from '../create/tapEdit'

const VALIDATION_MESSAGES: Record<ValidationErrorCode, string> = {
  EMPTY_INPUT: '予定を書いてください',
  INPUT_TOO_LONG: '長すぎます（2,000文字まで）',
  INVALID_RANGE: '終了は開始より後にしてください',
  PAST_EVENT: '過去の日時です',
  BEYOND_MAX_LEAD_TIME: '作成できるのは13ヶ月先までです',
  TOO_MANY_URLS: 'リンクは3つまでです',
}

/** GET/PATCH 共通のエラー文言（§6.5）。UNAUTHORIZED・NOT_FOUND はこの画面固有の文言にする */
function apiErrorMessage(code: ApiErrorCode): string {
  if (code === 'UNAUTHORIZED') return '編集トークンが無効です'
  if (code === 'NOT_FOUND') return 'ページが見つかりません（期限切れの可能性）'
  if (code === 'RATE_LIMITED') return 'しばらく時間をおいてから試してください'
  if (code in VALIDATION_MESSAGES) return VALIDATION_MESSAGES[code as ValidationErrorCode]
  return 'エラーが発生しました。しばらくしてからやり直してください'
}

/** `/{id}/edit` 以外なら null（不正な id・パスは呼び出し側で / へ戻す） */
function extractIdFromPathname(pathname: string): string | null {
  const match = /^\/([^/]+)\/edit$/.exec(pathname)
  if (match === null) return null
  return isValidPageId(match[1]) ? match[1] : null
}

/** GET で取得した現在値をプレビューに manual として埋める（§6.5） */
function applyManualFields(state: CreateState, fields: EventFields): void {
  state.title = { mode: 'manual', value: fields.title }
  state.location = { mode: 'manual', value: fields.location }
  state.memo = { mode: 'manual', value: fields.memo }
  state.datetime = {
    mode: 'manual',
    value: { start: fields.start, end: fields.end, isAllDay: fields.isAllDay },
  }
}

function main(): void {
  const pathId = extractIdFromPathname(location.pathname)
  if (pathId === null) {
    location.replace('/')
    return
  }
  // 以降のネストした関数（handleSubmit・loadInitial）は非同期で後から呼ばれるため、
  // TypeScript は pathId の null チェックをそこまで持ち越さない。string 型で束ね直す
  const id: string = pathId

  const cannotEditMessage = requireElement<HTMLElement>('cannot-edit-message')
  const loadErrorMessage = requireElement<HTMLElement>('load-error-message')

  const foundEntry = readHistory().find((e) => e.id === id) ?? null
  if (foundEntry === null) {
    cannotEditMessage.hidden = false
    return
  }
  const editToken: string = foundEntry.editToken

  const formSection = requireElement<HTMLElement>('edit-form')
  const textarea = requireElement('input', HTMLTextAreaElement)
  const previewContainer = requireElement<HTMLElement>('preview')
  const messageEl = requireElement<HTMLElement>('error-message')
  const submitButton = requireElement('submit', HTMLButtonElement)

  // 内容に応じて高さを伸ばす（create/main.ts と同じ挙動。§6.1）
  function autoResizeTextarea(): void {
    textarea.style.height = 'auto'
    const borderHeight = textarea.offsetHeight - textarea.clientHeight
    textarea.style.height = `${textarea.scrollHeight + borderHeight}px`
  }

  const state = createInitialState()
  // 読み込み前の previous は null にし、更新検証をまだ実行しない目印にする
  let previousFields: EventFields | null = null
  let apiError: string | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | undefined
  let latestSeq = 0

  const previewView = createPreviewView(previewContainer, state, () => render())

  function showMessage(text: string): void {
    messageEl.textContent = text
    messageEl.hidden = false
  }

  function hideMessage(): void {
    messageEl.hidden = true
  }

  function updateMessage(): void {
    if (apiError !== null) {
      showMessage(apiError)
      return
    }
    if (previousFields === null || state.rawText.trim() === '') {
      hideMessage()
      return
    }
    const result = validateEventFields(state.rawText, effectiveFields(state), new Date(), {
      mode: 'update',
      previous: previousFields,
    })
    if (result.ok) {
      hideMessage()
    } else {
      showMessage(VALIDATION_MESSAGES[result.code])
    }
  }

  function render(): void {
    previewView.render()
    updateMessage()
  }

  async function runInterpret(rawText: string): Promise<void> {
    const seq = ++latestSeq
    const parsed = await interpret(rawText, { now: new Date() })
    if (seq !== latestSeq) return
    state.rawText = rawText
    state.parsed = parsed
    render()
  }

  textarea.addEventListener('input', () => {
    apiError = null
    autoResizeTextarea()
    if (debounceTimer !== undefined) clearTimeout(debounceTimer)
    const rawText = textarea.value
    debounceTimer = setTimeout(() => {
      void runInterpret(rawText)
    }, PREVIEW_DEBOUNCE_MS)
  })

  async function handleSubmit(): Promise<void> {
    if (previousFields === null) return
    if (debounceTimer !== undefined) clearTimeout(debounceTimer)
    apiError = null
    await runInterpret(textarea.value)

    const fields = effectiveFields(state)
    const validation = validateEventFields(state.rawText, fields, new Date(), {
      mode: 'update',
      previous: previousFields,
    })
    if (!validation.ok) {
      showMessage(VALIDATION_MESSAGES[validation.code])
      return
    }

    submitButton.disabled = true
    hideMessage()
    try {
      const response = await updatePage(id, editToken, {
        rawText: state.rawText,
        fields: toEventFieldsJson(fields),
      })
      updateHistoryEntry(id, {
        fields: response.fields,
        expiresAt: response.expiresAt,
        updatedAt: response.updatedAt,
      })
      location.assign(`/done?id=${encodeURIComponent(id)}`)
    } catch (error) {
      submitButton.disabled = false
      apiError =
        error instanceof ApiRequestFailedError
          ? apiErrorMessage(error.code)
          : apiErrorMessage('INTERNAL')
      updateMessage()
    }
  }

  submitButton.addEventListener('click', () => {
    void handleSubmit()
  })

  async function loadInitial(): Promise<void> {
    try {
      const response = await getPage(id, editToken)
      const fields = fromEventFieldsJson(response.fields)
      previousFields = fields
      state.rawText = response.rawText
      applyManualFields(state, fields)
      textarea.value = state.rawText
      formSection.hidden = false
      autoResizeTextarea()
      await runInterpret(state.rawText)
    } catch (error) {
      loadErrorMessage.textContent =
        error instanceof ApiRequestFailedError
          ? apiErrorMessage(error.code)
          : apiErrorMessage('INTERNAL')
      loadErrorMessage.hidden = false
    }
  }

  void loadInitial()
}

main()
