import type { JSX } from 'hono/jsx/jsx-runtime'
import { CHANGE_BANNER_HOURS } from '../../core/config/limits'
import { buildGoogleCalendarUrl } from '../../core/google/buildGoogleCalendarUrl'
import { formatDateLabel, toJstParts } from '../../core/time/jst'
import { sameDateTime } from '../../core/validate/validateEventFields'
import type { ChangeSnapshot, EventFields } from '../../core/types'
import type { PageRecord } from '../../ports/pageRepository'
import type { Deps } from '../deps'
import { buildDetailUrl } from '../lib/ics'
import { Layout } from './Layout'

const HOUR_MS = 60 * 60 * 1000

function formatMonthDayJst(date: Date): string {
  const p = toJstParts(date)
  return `${p.m}/${p.d}`
}

function formatMonthDayTimeJst(date: Date): string {
  const p = toJstParts(date)
  return `${p.m}/${p.d} ${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`
}

/** previous_snapshot（日時のみ）を formatDateLabel / sameDateTime に渡せる形にする（§3.5） */
function snapshotAsEventFields(snapshot: ChangeSnapshot): EventFields {
  return {
    title: '',
    location: null,
    memo: null,
    start: snapshot.start,
    end: snapshot.end,
    isAllDay: snapshot.isAllDay,
  }
}

function buildOgImageUrl(publicOrigin: string, pageId: string, version: number): string {
  const url = new URL(`/${pageId}/ogp.png`, publicOrigin)
  url.searchParams.set('v', String(version))
  return url.toString()
}

/** 空文字・空白のみの場所・メモを「無し」として扱う。編集画面が空欄を `''` で送ってくることがある（§3.5 と同じ扱い） */
function nonBlank(value: string | null): string | null {
  return value !== null && value.trim() !== '' ? value : null
}

function ChangeBanner({ page, currentDateLabel }: { page: PageRecord; currentDateLabel: string }) {
  const snapshot = page.previousSnapshot
  if (snapshot === null) return null
  const dateTimeChanged = !sameDateTime(snapshotAsEventFields(snapshot), page.event)

  return (
    <section data-section="change-banner" class="change-banner">
      {dateTimeChanged && (
        <p>
          この予定は変更されました 日時: {formatDateLabel(snapshotAsEventFields(snapshot))} →{' '}
          {currentDateLabel}
        </p>
      )}
      {snapshot.titleChanged && <p>タイトルが変更されました</p>}
      {snapshot.locationChanged && <p>場所が変更されました</p>}
    </section>
  )
}

export interface DetailPageProps {
  page: PageRecord
  config: Deps['config']
  now: Date
}

/** 詳細ページ（§6.3）。要素の順序はここで固定する。hono/jsx の自動エスケープにのみ依存する（§9.1） */
export function DetailPage({ page, config, now }: DetailPageProps): JSX.Element {
  const { event } = page
  const detailUrl = buildDetailUrl(config.publicOrigin, page.id)
  const dateLabel = formatDateLabel(event)
  const location = nonBlank(event.location)
  const memo = nonBlank(event.memo)
  // E2E_FIXED_NOW（固定時計）の下では作成と更新の now() が同一になり updatedAt が進まないため、
  // 更新回数を表す version で判定する（§8）
  const isEdited = page.version > 1
  const showChangeBanner =
    page.changedAt !== null &&
    now.getTime() - page.changedAt.getTime() <= CHANGE_BANNER_HOURS * HOUR_MS

  const head = (
    <>
      <meta property="og:title" content={event.title} />
      <meta property="og:description" content={location ? `${dateLabel} ${location}` : dateLabel} />
      <meta
        property="og:image"
        content={buildOgImageUrl(config.publicOrigin, page.id, page.version)}
      />
      <meta property="og:url" content={detailUrl} />
      <meta name="twitter:card" content="summary_large_image" />
    </>
  )

  return (
    <Layout
      title={`${event.title} - ${config.serviceName}`}
      cssHref="/assets/css/detail.css"
      scriptSrc="/assets/js/detail.js"
      head={head}
    >
      <h1 data-section="title">{event.title}</h1>

      {page.issuerName !== null && (
        <p data-section="issuer" class="issuer">
          {page.issuerName} 主催
        </p>
      )}

      {showChangeBanner && <ChangeBanner page={page} currentDateLabel={dateLabel} />}

      <p data-section="datetime" class="datetime">
        {dateLabel}
      </p>

      {location !== null && (
        <p data-section="location" class="location">
          {location}
          <br />
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`}
          >
            地図で見る ↗
          </a>
        </p>
      )}

      {event.start !== null && event.end !== null ? (
        <section data-section="calendar" class="calendar-actions">
          <a
            data-calendar="google"
            href={buildGoogleCalendarUrl({
              title: event.title,
              location,
              memo,
              start: event.start,
              end: event.end,
              isAllDay: event.isAllDay,
              detailUrl,
            })}
          >
            Googleカレンダー
          </a>
          <a data-calendar="ics" href={`/${page.id}.ics`}>
            その他（ics）
          </a>
          {isEdited && (
            <p class="calendar-notice">
              カレンダーに追加した後の変更は自動では反映されません。最新はこのページで確認してください
            </p>
          )}
        </section>
      ) : (
        <p data-section="calendar" class="calendar-actions-empty">
          日時が決まったら追加できます
        </p>
      )}

      {memo !== null && (
        <p data-section="memo" class="memo">
          {memo.split('\n').map((line, i) => (
            <>
              {i > 0 && <br />}
              {line}
            </>
          ))}
        </p>
      )}

      <hr data-section="divider" />

      <p data-section="cta" class="cta">
        あなたも予定URLを作れます <a href="/new?ref=detail_cta">作ってみる</a>
      </p>

      {/* 広告枠（Phase 1 は DOM に何も出さない） */}

      <footer data-section="footer">
        <p>
          {/* expiresAt は JST 0 時ちょうどのことがあり、そのまま暦日に変換すると
              実際にはもう見えなくなる日を指してしまう（終日イベント等）。1ms 前の暦日を表示する */}
          このページは {formatMonthDayJst(new Date(page.expiresAt.getTime() - 1))} まで表示されます
          {isEdited && <>、最終更新: {formatMonthDayTimeJst(page.updatedAt)}</>}
        </p>
        <p class="disclaimer">カレンダーに追加した後の変更は自動では反映されません</p>
      </footer>

      <a data-section="report" href={`/${page.id}/report`}>
        不適切なページを報告
      </a>
    </Layout>
  )
}
