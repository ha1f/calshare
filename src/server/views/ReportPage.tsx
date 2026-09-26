import type { FC } from 'hono/jsx'
import { MAX_REPORT_COMMENT_LENGTH } from '../../core/config/limits'
import type { ReportReason } from '../../core/types'

export interface ReportPageProps {
  pageId: string
}

const REASON_OPTIONS: { value: ReportReason; label: string }[] = [
  { value: 'spam', label: 'スパム' },
  { value: 'personal_info', label: '個人情報' },
  { value: 'inappropriate', label: '不快な内容' },
  { value: 'other', label: 'その他' },
]

/**
 * `/:id/report` の通報フォーム（§9.4・§9.8）。自己完結の小さな HTML にしている。
 * 送信ボタンは `type="button"` にし、JS（`web/report/main.ts`）が `data-page-id` を読んで
 * JSON で送信する。素の form submit にすると、コメントがクエリ文字列としてアクセスログに残る
 */
export const ReportPage: FC<ReportPageProps> = ({ pageId }) => (
  <html lang="ja">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="robots" content="noindex, nofollow" />
      <title>不適切なページを報告 - calshare</title>
      <link rel="stylesheet" href="/assets/css/base.css" />
    </head>
    <body>
      <main>
        <h1>不適切なページを報告</h1>
        <p>このページの内容について報告します。運営が内容を確認します。</p>
        <form id="report-form" data-page-id={pageId}>
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
          <button type="button" id="report-submit">
            報告する
          </button>
        </form>
        <p id="report-result" role="status" aria-live="polite"></p>
      </main>
      <script type="module" src="/assets/js/report.js"></script>
    </body>
  </html>
)
