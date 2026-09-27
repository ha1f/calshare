import type { FC } from 'hono/jsx'
import { MAX_REPORT_COMMENT_LENGTH } from '../../core/config/limits'
import type { ReportReason } from '../../core/types'
import { Layout } from './Layout'

export interface ReportPageProps {
  pageId: string
  serviceName: string
}

const REASON_OPTIONS: { value: ReportReason; label: string }[] = [
  { value: 'spam', label: 'スパム' },
  { value: 'personal_info', label: '個人情報' },
  { value: 'inappropriate', label: '不快な内容' },
  { value: 'other', label: 'その他' },
]

/**
 * `/:id/report` の通報フォーム（§9.4・§9.8）。`web/report/main.ts` が submit イベントを
 * preventDefault して `data-page-id` 宛に JSON で送信する。`method="post"` は JS 実行前に
 * 素の送信が起きても GET（コメントがクエリ文字列に残る）にならないための保険
 */
export const ReportPage: FC<ReportPageProps> = ({ pageId, serviceName }) => (
  <Layout title={`不適切なページを報告 - ${serviceName}`} scriptSrc="/assets/js/report.js">
    <main>
      <h1>不適切なページを報告</h1>
      <p>このページの内容について報告します。運営が内容を確認します。</p>
      <form id="report-form" method="post" data-page-id={pageId}>
        <fieldset>
          <legend>理由</legend>
          {REASON_OPTIONS.map((option, index) => (
            <label key={option.value}>
              <input
                type="radio"
                name="reason"
                value={option.value}
                required
                checked={index === 0}
              />
              {option.label}
            </label>
          ))}
        </fieldset>
        <label for="comment">{`補足（任意・${MAX_REPORT_COMMENT_LENGTH}文字まで）`}</label>
        <textarea id="comment" name="comment" maxlength={MAX_REPORT_COMMENT_LENGTH}></textarea>
        <button type="submit" id="report-submit">
          報告する
        </button>
      </form>
      <p id="report-result" role="status" aria-live="polite" tabindex={-1}></p>
    </main>
  </Layout>
)
