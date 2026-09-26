import { afterEach, describe, expect, it, vi } from 'vitest'
import { autoResizeTextarea, requireElement } from '../../../../src/web/lib/dom'

class FakeHTMLElement {}
class FakeHTMLAnchorElement extends FakeHTMLElement {}
class FakeHTMLButtonElement extends FakeHTMLElement {}

function stubDom(elements: Record<string, object>): void {
  vi.stubGlobal('HTMLElement', FakeHTMLElement)
  vi.stubGlobal('document', {
    getElementById: (id: string) => elements[id] ?? null,
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('requireElement', () => {
  it('id に対応する要素が無ければ例外', () => {
    stubDom({})
    expect(() => requireElement('missing')).toThrow('#missing is missing')
  })

  it('ctor を省略すれば型チェックせずそのまま返す', () => {
    const el = new FakeHTMLElement()
    stubDom({ foo: el })
    expect(requireElement('foo')).toBe(el)
  })

  it('ctor で指定した型と違う要素なら例外', () => {
    const el = new FakeHTMLButtonElement()
    stubDom({ foo: el })
    expect(() =>
      requireElement('foo', FakeHTMLAnchorElement as unknown as new () => HTMLElement),
    ).toThrow('#foo is not a FakeHTMLAnchorElement')
  })

  it('ctor で指定した型と合っていればその要素を返す', () => {
    const el = new FakeHTMLAnchorElement()
    stubDom({ foo: el })
    expect(requireElement('foo', FakeHTMLAnchorElement as unknown as new () => HTMLElement)).toBe(
      el,
    )
  })
})

function fakeTextarea(sizes: {
  offsetHeight: number
  clientHeight: number
  scrollHeight: number
}): { textarea: HTMLTextAreaElement; heightHistory: string[] } {
  const heightHistory: string[] = []
  const style = {} as CSSStyleDeclaration
  Object.defineProperty(style, 'height', {
    set: (value: string) => heightHistory.push(value),
    get: () => heightHistory[heightHistory.length - 1] ?? '',
  })
  return { textarea: { style, ...sizes } as unknown as HTMLTextAreaElement, heightHistory }
}

describe('autoResizeTextarea', () => {
  it('scrollHeight に border 分を足した高さを style.height に設定する', () => {
    const { textarea } = fakeTextarea({ offsetHeight: 42, clientHeight: 40, scrollHeight: 100 })

    autoResizeTextarea(textarea)

    // border-box の外寸（offsetHeight）と内寸（clientHeight）の差が border 分。100 + 2 = 102px
    expect(textarea.style.height).toBe('102px')
  })

  it('先に auto にしてから scrollHeight を測るため、行を消したときも縮む', () => {
    const { textarea, heightHistory } = fakeTextarea({
      offsetHeight: 22,
      clientHeight: 20,
      scrollHeight: 30,
    })

    autoResizeTextarea(textarea)

    expect(heightHistory).toEqual(['auto', '32px'])
  })
})
