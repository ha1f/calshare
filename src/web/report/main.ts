import type { CreateReportRequest } from '../../core/api/types'
import { fetchWithTimeout } from '../lib/api'

const SUCCESS_MESSAGE = '報告を受け付けました。ご協力ありがとうございます。'
const RATE_LIMITED_MESSAGE = 'しばらく時間をおいてから試してください。'
const FAILURE_MESSAGE = '送信に失敗しました。時間をおいて試してください。'

function buildRequestBody(form: HTMLFormElement): CreateReportRequest | null {
  const reason = form.querySelector<HTMLInputElement>('input[name="reason"]:checked')?.value
  if (
    reason !== 'spam' &&
    reason !== 'personal_info' &&
    reason !== 'inappropriate' &&
    reason !== 'other'
  ) {
    return null
  }
  const rawComment = form.querySelector<HTMLTextAreaElement>('#comment')?.value.trim() ?? ''
  return { reason, comment: rawComment === '' ? null : rawComment }
}

interface SubmitResult {
  ok: boolean
  code?: string | undefined
}

async function submitReport(pageId: string, body: CreateReportRequest): Promise<SubmitResult> {
  const res = await fetchWithTimeout(
    `/api/pages/${pageId}/reports`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    'submit report',
  )
  if (res.ok) return { ok: true }
  const code = await res
    .json()
    .then((json) => (json as { code?: string }).code)
    .catch(() => undefined)
  return { ok: false, code }
}

function main(): void {
  const form = document.querySelector<HTMLFormElement>('#report-form')
  const result = document.querySelector<HTMLParagraphElement>('#report-result')
  const submitButton = document.querySelector<HTMLButtonElement>('#report-submit')
  if (!form || !result || !submitButton) return

  const pageId = form.dataset.pageId
  if (!pageId) return

  form.addEventListener('submit', (event) => {
    // 素の form submit（GET でコメントがクエリ文字列に残る）を必ず止めてから JSON で送る
    event.preventDefault()

    const body = buildRequestBody(form)
    if (!body) return

    submitButton.disabled = true
    result.textContent = ''

    submitReport(pageId, body)
      .then((response) => {
        if (response.ok) {
          result.textContent = SUCCESS_MESSAGE
          form.hidden = true
          return
        }
        result.textContent =
          response.code === 'RATE_LIMITED' ? RATE_LIMITED_MESSAGE : FAILURE_MESSAGE
      })
      .catch(() => {
        result.textContent = FAILURE_MESSAGE
      })
      .finally(() => {
        submitButton.disabled = false
      })
  })
}

main()
