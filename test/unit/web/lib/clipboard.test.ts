import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyToClipboard } from '../../../../src/web/lib/clipboard'

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubExecCommandDocument(execCommandResult: boolean) {
  const textareaStub = {
    value: '',
    style: {} as Record<string, string>,
    focus: vi.fn(),
    select: vi.fn(),
  }
  const appendChild = vi.fn()
  const removeChild = vi.fn()
  const execCommand = vi.fn().mockReturnValue(execCommandResult)
  vi.stubGlobal('document', {
    createElement: vi.fn().mockReturnValue(textareaStub),
    body: { appendChild, removeChild },
    execCommand,
  })
  return { textareaStub, appendChild, removeChild, execCommand }
}

describe('copyToClipboard', () => {
  it('navigator.clipboard.writeText が使えれば true を返す', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    const result = await copyToClipboard('https://example.com/abc123def456')

    expect(writeText).toHaveBeenCalledWith('https://example.com/abc123def456')
    expect(result).toBe(true)
  })

  it('navigator.clipboard が無い環境では execCommand にフォールバックする', async () => {
    vi.stubGlobal('navigator', {})
    const { textareaStub, appendChild, removeChild, execCommand } = stubExecCommandDocument(true)

    const result = await copyToClipboard('https://example.com/abc123def456')

    expect(textareaStub.value).toBe('https://example.com/abc123def456')
    expect(appendChild).toHaveBeenCalledWith(textareaStub)
    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(removeChild).toHaveBeenCalledWith(textareaStub)
    expect(result).toBe(true)
  })

  it('navigator.clipboard.writeText が失敗しても execCommand にフォールバックする', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    })
    const { execCommand } = stubExecCommandDocument(true)

    const result = await copyToClipboard('https://example.com/abc123def456')

    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(result).toBe(true)
  })

  it('execCommand が失敗すると false を返す', async () => {
    vi.stubGlobal('navigator', {})
    stubExecCommandDocument(false)

    const result = await copyToClipboard('https://example.com/abc123def456')

    expect(result).toBe(false)
  })
})
