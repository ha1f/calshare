import { MAX_WEBHOOK_COMMENT_LENGTH } from '../../core/config/limits'
import { replaceUrls } from '../../core/text/urlPattern'
import type { ReportReason } from '../../core/types'
import type { Logger } from '../../ports/logger'
import type { Notifier, ReportNotification } from '../../ports/notifier'

type WebhookKind = 'discord' | 'slack' | 'unknown'

const DISCORD_HOSTS = new Set(['discord.com', 'discordapp.com'])
const SLACK_HOSTS = new Set(['hooks.slack.com'])

const REASON_LABELS: Record<ReportReason, string> = {
  spam: 'スパム',
  personal_info: '個人情報',
  inappropriate: '不快な内容',
  other: 'その他',
}

/** 通報件数がこれ以上なら通知本文で強調する（§9.4） */
const REPORT_COUNT_WARNING_THRESHOLD = 3

function resolveWebhookKind(url: string): { kind: WebhookKind; host: string } {
  let hostname: string
  try {
    hostname = new URL(url).hostname
  } catch {
    // url 自体をログに出すと、スキーム無しでホストとトークンが繋がった値（秘密情報）が漏れる
    return { kind: 'unknown', host: 'invalid' }
  }
  if (DISCORD_HOSTS.has(hostname)) return { kind: 'discord', host: hostname }
  if (SLACK_HOSTS.has(hostname)) return { kind: 'slack', host: hostname }
  return { kind: 'unknown', host: hostname }
}

/**
 * コメントから URL を「[リンク]」に置換し（§9.4）、MAX_WEBHOOK_COMMENT_LENGTH に切り詰める。
 * サロゲートペアの途中で切ると壊れた文字が残るため Array.from で 1 文字ずつ数える
 */
function truncateComment(comment: string | null): string | null {
  if (comment === null) return null
  const withoutUrls = replaceUrls(comment, '[リンク]')
  const codePoints = Array.from(withoutUrls)
  return codePoints.length > MAX_WEBHOOK_COMMENT_LENGTH
    ? codePoints.slice(0, MAX_WEBHOOK_COMMENT_LENGTH).join('')
    : withoutUrls
}

function buildSummaryLines(n: ReportNotification): string[] {
  const lines = [
    `ページ: ${n.url}`,
    `理由: ${REASON_LABELS[n.reason]}`,
    `通報件数: ${n.reportCount}`,
    `同一送信元の有効ページ数: ${n.activePagesFromSameCreator}`,
  ]
  if (n.reportCount >= REPORT_COUNT_WARNING_THRESHOLD) {
    lines.push(`【要確認】通報件数が${REPORT_COUNT_WARNING_THRESHOLD}件以上です`)
  }
  return lines
}

/** コードブロックの終端（```）をコメントで閉じられないよう、バックティックを全角に置き換える */
function escapeDiscordCodeBlock(comment: string): string {
  return comment.replace(/`/g, '｀')
}

function buildDiscordPayload(n: ReportNotification): unknown {
  const comment = truncateComment(n.comment)
  const lines = buildSummaryLines(n)
  if (comment !== null) {
    lines.push('コメント:', '```', escapeDiscordCodeBlock(comment), '```')
  }
  return {
    content: lines.join('\n'),
    // 通報者は匿名なので、通知本文由来のメンションが実際の相手に届かないようにする（§9.4）
    allowed_mentions: { parse: [] },
  }
}

function escapeSlackText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function buildSlackPayload(n: ReportNotification): unknown {
  const comment = truncateComment(n.comment)
  const lines = buildSummaryLines(n)
  if (comment !== null) lines.push(`コメント: ${comment}`)
  return {
    text: escapeSlackText(lines.join('\n')),
    // Slack の mrkdwn 記法（*太字* や <!everyone> 等のメンション記法）を無効にする。
    // & < > のエスケープは <!everyone> や <url|text> のような記法そのものを別途無害化している
    mrkdwn: false,
  }
}

/**
 * REPORT_WEBHOOK_URL のホストで Discord / Slack を判定して通報を通知する（§9.4）。
 * 未知のホストは warn ログを出すだけで送信しない。失敗時は例外を投げ、呼び出し側が
 * 通報の受理自体は失敗させない（ctx.waitUntil で送る。§9.4）
 */
export function createWebhookNotifier(url: string, logger: Logger): Notifier {
  return {
    async notifyReport(n: ReportNotification) {
      const { kind, host } = resolveWebhookKind(url)
      if (kind === 'unknown') {
        logger.warn('report_webhook_unknown_host', { host })
        return
      }

      const payload = kind === 'discord' ? buildDiscordPayload(n) : buildSlackPayload(n)
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        throw new Error(`webhook responded with ${res.status}`)
      }
    },
  }
}
