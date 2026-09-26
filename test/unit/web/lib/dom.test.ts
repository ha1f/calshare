import { afterEach, describe, expect, it, vi } from 'vitest'
import { requireElement } from '../../../../src/web/lib/dom'

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
