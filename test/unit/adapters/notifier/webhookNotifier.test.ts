import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWebhookNotifier } from '../../../../src/adapters/notifier/webhookNotifier'
import { MAX_WEBHOOK_COMMENT_LENGTH } from '../../../../src/core/config/limits'
import type { Logger } from '../../../../src/ports/logger'
import type { ReportNotification } from '../../../../src/ports/notifier'

function notification(overrides: Partial<ReportNotification> = {}): ReportNotification {
  return {
    pageId: 'page00000001',
    url: 'https://calshare.example/page00000001',
    reason: 'spam',
    comment: null,
    reportCount: 1,
    activePagesFromSameCreator: 1,
    ...overrides,
  }
}

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() } satisfies Logger
}

describe('createWebhookNotifier', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('Webhook 種別の判定（§9.4）', () => {
    it.each([
      ['discord.com', 'content'],
      ['discordapp.com', 'content'],
      ['hooks.slack.com', 'text'],
    ])('ホストが %s なら対応する payload の形（%s キー）で送る', async (host, bodyKey) => {
      const logger = createLogger()
      const notifier = createWebhookNotifier(`https://${host}/webhook/xxx`, logger)

      await notifier.notifyReport(notification())

      expect(fetchMock).toHaveBeenCalledOnce()
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as Record<string, unknown>
      expect(body).toHaveProperty(bodyKey)
      expect(logger.warn).not.toHaveBeenCalled()
    })

    it.each([['discord.com.evil.example'], ['evil.example'], ['not a url']])(
      '未知のホスト（%s）は warn ログを出すだけで送信しない',
      async (url) => {
        const logger = createLogger()
        const notifier = createWebhookNotifier(url, logger)

        await notifier.notifyReport(notification())

        expect(fetchMock).not.toHaveBeenCalled()
        expect(logger.warn).toHaveBeenCalledOnce()
        expect(logger.warn).toHaveBeenCalledWith('report_webhook_unknown_host', expect.anything())
        // url がそのままログに出ると、スキーム無しの秘密の Webhook URL がログに漏れる
        const [, data] = logger.warn.mock.calls[0] as [string, Record<string, unknown>]
        expect(JSON.stringify(data)).not.toContain(url)
      },
    )

    it('クエリで discord.com を装っても未知のホスト扱いになる', async () => {
      const logger = createLogger()
      const notifier = createWebhookNotifier('https://evil.example/?discord.com', logger)

      await notifier.notifyReport(notification())

      expect(fetchMock).not.toHaveBeenCalled()
      expect(logger.warn).toHaveBeenCalledOnce()
    })
  })

  describe('本文の扱い（§9.4）', () => {
    async function sentBody(url: string, n: ReportNotification): Promise<string> {
      const notifier = createWebhookNotifier(url, createLogger())
      await notifier.notifyReport(n)
      return fetchMock.mock.calls[0][1].body as string
    }

    it('Discord: allowed_mentions で @everyone を無効化し、コメントをコードブロックで囲む', async () => {
      const body = await sentBody(
        'https://discord.com/api/webhooks/1/xxx',
        notification({ comment: '@everyone https://evil.example 見て' }),
      )
      const json = JSON.parse(body) as { content: string; allowed_mentions: { parse: string[] } }

      expect(json.allowed_mentions).toEqual({ parse: [] })
      expect(json.content).toContain('```')
      expect(json.content).not.toContain('https://evil.example')
      expect(json.content).toContain('[リンク]')
    })

    it('Discord: コメント中の```を全角バックティックに置き換え、コードブロックを閉じさせない', async () => {
      const body = await sentBody(
        'https://discord.com/api/webhooks/1/xxx',
        notification({ comment: '```\n@everyone\n```' }),
      )
      const json = JSON.parse(body) as { content: string }

      expect(json.content).not.toMatch(/```\n@everyone/)
      expect(json.content).toContain('｀｀｀')
    })

    it('Slack: & < > をエスケープし mrkdwn: false で送る', async () => {
      const body = await sentBody(
        'https://hooks.slack.com/services/xxx',
        notification({ comment: '<script>alert(1)</script> & https://evil.example' }),
      )
      const json = JSON.parse(body) as { text: string; mrkdwn: boolean }

      expect(json.mrkdwn).toBe(false)
      expect(json.text).toContain('&lt;script&gt;')
      expect(json.text).toContain('&amp;')
      expect(json.text).not.toContain('https://evil.example')
    })

    it('Slack: <!everyone> のメンション記法をエスケープで無害化する', async () => {
      const body = await sentBody(
        'https://hooks.slack.com/services/xxx',
        notification({ comment: '<!everyone> 見て' }),
      )
      const json = JSON.parse(body) as { text: string }

      expect(json.text).toContain('&lt;!everyone&gt;')
      expect(json.text).not.toContain('<!everyone>')
    })

    it('本文に載る URL は詳細ページの 1 本だけ', async () => {
      const body = await sentBody(
        'https://hooks.slack.com/services/xxx',
        notification({
          url: 'https://calshare.example/page00000001',
          comment: 'http://a.example http://b.example',
        }),
      )
      const urls = body.match(/https?:\/\/[^\s"\\]+/g) ?? []

      expect(urls).toEqual(['https://calshare.example/page00000001'])
    })

    it('コメントが MAX_WEBHOOK_COMMENT_LENGTH（コードポイント単位）を超えると切り詰められる', async () => {
      const longComment = '😀'.repeat(MAX_WEBHOOK_COMMENT_LENGTH + 50) // サロゲートペアなので長さの数え方を間違えると壊れる
      const body = await sentBody(
        'https://hooks.slack.com/services/xxx',
        notification({ comment: longComment }),
      )
      const json = JSON.parse(body) as { text: string }
      const commentLine = json.text.split('\n').find((l) => l.startsWith('コメント: '))

      expect(commentLine).toBeDefined()
      expect(Array.from(commentLine!.replace('コメント: ', ''))).toHaveLength(
        MAX_WEBHOOK_COMMENT_LENGTH,
      )
    })

    it('通報件数が 3 件以上なら強調文言が本文に含まれる', async () => {
      const body = await sentBody(
        'https://hooks.slack.com/services/xxx',
        notification({ reportCount: 3 }),
      )
      const json = JSON.parse(body) as { text: string }

      expect(json.text).toContain('要確認')
    })

    it('コメントが無ければコメント行を出さない', async () => {
      const body = await sentBody(
        'https://hooks.slack.com/services/xxx',
        notification({ comment: null }),
      )
      const json = JSON.parse(body) as { text: string }

      expect(json.text).not.toContain('コメント')
    })
  })

  it('Webhook が非 2xx を返すと例外を投げる', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }))
    const notifier = createWebhookNotifier('https://hooks.slack.com/services/xxx', createLogger())

    await expect(notifier.notifyReport(notification())).rejects.toThrow()
  })
})
