import { afterEach, describe, expect, it, vi } from 'vitest'
import { canShare, shareUrl } from '../../../../src/web/lib/share'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('canShare', () => {
  it('navigator.share が関数なら true', () => {
    vi.stubGlobal('navigator', { share: vi.fn() })
    expect(canShare()).toBe(true)
  })

  it('navigator.share が無ければ false（フィーチャー検出）', () => {
    vi.stubGlobal('navigator', {})
    expect(canShare()).toBe(false)
  })
})

describe('shareUrl', () => {
  it('navigator.share に title と url を渡す', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { share })

    await shareUrl({ title: '飲み会', url: 'https://example.com/abc123def456' })

    expect(share).toHaveBeenCalledWith({ title: '飲み会', url: 'https://example.com/abc123def456' })
  })

  it('ユーザーがキャンセルした AbortError は無視する', async () => {
    const error = new Error('cancelled')
    error.name = 'AbortError'
    vi.stubGlobal('navigator', { share: vi.fn().mockRejectedValue(error) })

    await expect(shareUrl({ title: 'x', url: 'https://example.com/x' })).resolves.toBeUndefined()
  })

  it('AbortError 以外の失敗も無視する（呼び出し元に伝える手段が無いため）', async () => {
    vi.stubGlobal('navigator', { share: vi.fn().mockRejectedValue(new Error('boom')) })

    await expect(shareUrl({ title: 'x', url: 'https://example.com/x' })).resolves.toBeUndefined()
  })
})
