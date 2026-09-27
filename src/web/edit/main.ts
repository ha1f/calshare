import type { ApiErrorCode } from '../../core/api/types'
import { requireDefined } from '../../core/assert'
import { PREVIEW_DEBOUNCE_MS } from '../../core/config/limits'
import { isValidPageId } from '../../core/id/crockford'
import { fromEventFieldsJson, toEventFieldsJson } from '../../core/types'
import type { EventFields } from '../../core/types'
import { validateEventFields } from '../../core/validate/validateEventFields'
import { ApiRequestFailedError, getPage, updatePage } from '../lib/api'
import { autoResizeTextarea, requireElement } from '../lib/dom'
import { readHistory, updateHistoryEntry } from '../lib/history'
import { apiErrorMessage as sharedApiErrorMessage, VALIDATION_MESSAGES } from '../lib/messages'
import { createInitialState, effectiveFields, interpret } from '../create/preview'
import type { CreateState } from '../create/preview'
import { createPreviewView } from '../create/tapEdit'

/** UNAUTHORIZED・NOT_FOUND はこの画面固有の文言にする（§6.5） */
function apiErrorMessage(code: ApiErrorCode): string {
  return sharedApiErrorMessage(code, {
    UNAUTHORIZED: '編集トークンが無効です',
    NOT_FOUND: 'ページが見つかりません（期限切れの可能性）',
  })
}

/** `/{id}/edit` 以外なら null（不正な id・パスは呼び出し側で / へ戻す） */
function extractIdFromPathname(pathname: string): string | null {
  const match = /^\/([^/]+)\/edit$/.exec(pathname)
  if (match === null) return null
  const id = requireDefined(match[1], 'capture group 1 must exist when match succeeds')
  return isValidPageId(id) ? id : null
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
  // handleSubmit・loadInitial は関数宣言として巻き上げられるため、TypeScript は
  // 上の null チェックによる絞り込みをその中まで持ち越さない。string 型で束ね直す
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
    autoResizeTextarea(textarea)
    if (debounceTimer !== undefined) clearTimeout(debounceTimer)
    const rawText = textarea.value
    debounceTimer = setTimeout(() => {
      void runInterpret(rawText)
    }, PREVIEW_DEBOUNCE_MS)
  })

  async function handleSubmit(): Promise<void> {
    if (previousFields === null) return
    if (submitButton.disabled) return
    if (debounceTimer !== undefined) clearTimeout(debounceTimer)
    apiError = null
    submitButton.disabled = true
    try {
      await runInterpret(textarea.value)

      const fields = effectiveFields(state)
      const validation = validateEventFields(state.rawText, fields, new Date(), {
        mode: 'update',
        previous: previousFields,
      })
      if (!validation.ok) {
        submitButton.disabled = false
        showMessage(VALIDATION_MESSAGES[validation.code])
        return
      }

      hideMessage()
      const response = await updatePage(id, editToken, {
        rawText: state.rawText,
        fields: toEventFieldsJson(fields),
      })
      updateHistoryEntry(id, {
        fields: response.fields,
        expiresAt: response.expiresAt,
        updatedAt: response.updatedAt,
        version: response.version,
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
      autoResizeTextarea(textarea)
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
