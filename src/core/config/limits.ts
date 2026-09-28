export const MAX_EVENT_LEAD_TIME_MONTHS = 13
export const RETENTION_DAYS_AFTER_LAST_EVENT = 7
export const RETENTION_DAYS_FOR_DRAFT = 7
export const DEFAULT_EVENT_DURATION_MINUTES = 60
/** 午前・午後の語が無い 1〜N 時を午後と読む（規則 T2）。0 にするとリテラル解釈になる */
export const PM_HEURISTIC_MAX_HOUR = 7
/** input イベントからプレビューを再解釈するまでのデバウンス（§6.1） */
export const PREVIEW_DEBOUNCE_MS = 150
/** 完成画面でコピー結果のメッセージを表示し続ける時間（§6.2） */
export const COPY_MESSAGE_DURATION_MS = 2000
export const MAX_INPUT_LENGTH = 2000
/** 作成・更新・通報 API の本文の byte 上限。JSON をパースする前に弾く（§5.7 の (2)） */
export const MAX_BODY_BYTES = 32 * 1024
export const MAX_TITLE_LENGTH = 200
export const MAX_LOCATION_LENGTH = 200
export const MAX_MEMO_LENGTH = 2000
export const MAX_MEMO_URLS = 3
export const MAX_REPORT_COMMENT_LENGTH = 500
/** Webhook 通知に載せる通報コメントの最大文字数。全文は D1 の reports で見る（§9.4） */
export const MAX_WEBHOOK_COMMENT_LENGTH = 200
/** 通報件数がこれ以上なら Webhook 通知の本文で強調する（§9.4） */
export const REPORT_COUNT_WARNING_THRESHOLD = 3
/** Webhook 通知の fetch を打ち切るまでの時間。応答が無い送信先で waitUntil を専有し続けないため（§9.4） */
export const WEBHOOK_FETCH_TIMEOUT_MS = 5000
/** Google カレンダーリンクの details に載せるメモの最大文字数（§7.1） */
export const MAX_CALENDAR_DETAILS_LENGTH = 500
/** ブラウザから API を呼ぶ fetch を打ち切るまでの時間。回線が不安定でも送信ボタンが固まって見えないようにする（docs/guidelines.md §6.4） */
export const API_REQUEST_TIMEOUT_MS = 10000
export const PAGE_ID_LENGTH = 12
export const CHANGE_BANNER_HOURS = 48
export const DETAIL_CACHE_MAX_AGE_SECONDS = 60
export const ICS_CACHE_MAX_AGE_SECONDS = 60
export const OGP_CACHE_MAX_AGE_SECONDS = 300
export const OGP_FAILURE_CACHE_SECONDS = 300
export const OGP_IMAGE_WIDTH = 1200
export const OGP_IMAGE_HEIGHT = 630
export const DEVICE_COOKIE_NAME = 'cs_device'
export const DEVICE_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60
export const RATE_LIMITS = {
  create: { ipPerHour: 30, ipPerDay: 100, devicePerDay: 20 }, // IP 側は CGNAT を考慮して緩め（§9.3）
  report: { ipPerHour: 10, ipPerDay: 30 },
} as const
/** IPv6 はこのプレフィックス長に丸めてから ip_hash を計算する（§9.3） */
export const IPV6_BUCKET_PREFIX_BITS = 64
/**
 * CF-Connecting-IP が無いリクエストの ip_hash（§9.3）。送信元を区別しない値なので、同一送信元の判定（§9.4）では
 * IP の一致に使わない。pages.creator_ip_hash に保存され、scripts/cf/moderation-sql.mjs も同じ値を持つので変えない
 */
export const UNKNOWN_IP_HASH = 'unknown'
export const REPORT_DEDUPE_HOURS = 24
/** D1 は 1 クエリのバインドパラメータが 100 個まで。GC のバッチと deleteByIds の分割単位に使う */
export const D1_MAX_BIND_PARAMS = 100
export const GC_BATCH_SIZE = 100
export const GC_MAX_BATCHES_PER_RUN = 20
export const RATE_LIMIT_COUNTER_RETENTION_DAYS = 2
/** ログの error.message を切り詰める長さ（§9.6） */
export const MAX_LOG_ERROR_MESSAGE_LENGTH = 200
