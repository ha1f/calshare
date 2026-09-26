import { PREVIEW_DEBOUNCE_MS } from '../../core/config/limits'
import { toEventFieldsJson } from '../../core/types'
import type { CreateSource } from '../../core/types'
import { validateEventFields } from '../../core/validate/validateEventFields'
import { ApiRequestFailedError, createPage } from '../lib/api'
import { autoResizeTextarea, requireElement } from '../lib/dom'
import { addHistoryEntry } from '../lib/history'
import { apiErrorMessage, VALIDATION_MESSAGES } from '../lib/messages'
import { createInitialState, effectiveFields, interpret, type CreateState } from './preview'
import { resolveCreateSource, resolvePrefillFromSearch, type PrefillResult } from './prefill'
import { createPreviewView } from './tapEdit'

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

  autoResizeTextarea(textarea)

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
    autoResizeTextarea(textarea)
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
        version: response.version,
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
