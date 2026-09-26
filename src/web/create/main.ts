import type { ApiErrorCode } from '../../core/api/types'
import { PREVIEW_DEBOUNCE_MS } from '../../core/config/limits'
import { toEventFieldsJson } from '../../core/types'
import type { CreateSource, ValidationErrorCode } from '../../core/types'
import { validateEventFields } from '../../core/validate/validateEventFields'
import { ApiRequestFailedError, createPage } from '../lib/api'
import { requireElement } from '../lib/dom'
import { addHistoryEntry } from '../lib/history'
import { createInitialState, effectiveFields, interpret, type CreateState } from './preview'
import { resolveCreateSource, resolvePrefillFromSearch, type PrefillResult } from './prefill'
import { createPreviewView } from './tapEdit'

const VALIDATION_MESSAGES: Record<ValidationErrorCode, string> = {
  EMPTY_INPUT: '予定を書いてください',
  INPUT_TOO_LONG: '長すぎます（2,000文字まで）',
  INVALID_RANGE: '終了は開始より後にしてください',
  PAST_EVENT: '過去の日時です',
  BEYOND_MAX_LEAD_TIME: '作成できるのは13ヶ月先までです',
  TOO_MANY_URLS: 'リンクは3つまでです',
}

function apiErrorMessage(code: ApiErrorCode): string {
  if (code === 'RATE_LIMITED') return 'しばらく時間をおいてから試してください'
  if (code in VALIDATION_MESSAGES) return VALIDATION_MESSAGES[code as ValidationErrorCode]
  return 'エラーが発生しました。しばらくしてからやり直してください'
}

function applyPrefill(state: CreateState, prefill: PrefillResult): void {
  state.rawText = prefill.rawText

  if (prefill.manualKeys.includes('title') && prefill.fields.title !== undefined) {
    state.title = { mode: 'manual', value: prefill.fields.title }
  }
  if (prefill.manualKeys.includes('location')) {
    state.location = { mode: 'manual', value: prefill.fields.location ?? null }
  }
  if (prefill.manualKeys.includes('memo')) {
    state.memo = { mode: 'manual', value: prefill.fields.memo ?? null }
  }
  if (prefill.manualKeys.includes('start')) {
    state.datetime = {
      mode: 'manual',
      value: {
        start: prefill.fields.start ?? null,
        end: prefill.fields.end ?? null,
        isAllDay: prefill.fields.isAllDay ?? false,
      },
    }
  }
}

function main(): void {
  const textarea = requireElement('input', HTMLTextAreaElement)
  // 静的 HTML 側は `<textarea id="input">` のまま保つ（staticAssets.test.ts が厳密一致で見ている）ため、
  // placeholder はここで付ける。見た目は create.css の #input セレクタで当てる
  textarea.placeholder = '9/20 19時 渋谷で飲み会'

  const previewContainer = requireElement<HTMLElement>('preview')
  const messageEl = requireElement<HTMLElement>('error-message')
  const submitButton = requireElement('submit', HTMLButtonElement)

  const prefill = resolvePrefillFromSearch(location.search, { now: new Date() })
  const source: CreateSource = resolveCreateSource(location.search, prefill)
  const state = createInitialState()
  applyPrefill(state, prefill)
  textarea.value = state.rawText

  // 内容に応じて高さを伸ばす（§6.1「自動リサイズの textarea」）。一度縮めてから
  // scrollHeight に合わせないと、行を消したときに縮まない
  function autoResizeTextarea(): void {
    textarea.style.height = 'auto'
    // box-sizing: border-box では height が border 込みの外寸になる一方、scrollHeight は border を
    // 含まないため、border 分を足さないと内容がちょうど border の幅だけはみ出してスクロールする
    const borderHeight = textarea.offsetHeight - textarea.clientHeight
    textarea.style.height = `${textarea.scrollHeight + borderHeight}px`
  }
  autoResizeTextarea()

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
    if (state.rawText.trim() === '') {
      hideMessage()
      return
    }
    const result = validateEventFields(state.rawText, effectiveFields(state), new Date(), {
      mode: 'create',
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
    if (debounceTimer !== undefined) clearTimeout(debounceTimer)
    apiError = null
    // デバウンス待ち中の値を確定させてから検証する（§6.1）
    await runInterpret(textarea.value)

    const fields = effectiveFields(state)
    const validation = validateEventFields(state.rawText, fields, new Date(), { mode: 'create' })
    if (!validation.ok) {
      showMessage(VALIDATION_MESSAGES[validation.code])
      return
    }

    submitButton.disabled = true
    hideMessage()
    try {
      const response = await createPage({
        rawText: state.rawText,
        fields: toEventFieldsJson(fields),
        source,
      })
      addHistoryEntry({
        id: response.id,
        url: response.url,
        editToken: response.editToken,
        fields: response.fields,
        expiresAt: response.expiresAt,
        createdAt: response.createdAt,
        updatedAt: response.updatedAt,
      })
      location.assign(`/done?id=${encodeURIComponent(response.id)}`)
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

  void runInterpret(state.rawText)
}

main()
