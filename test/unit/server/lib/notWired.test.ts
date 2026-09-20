import { describe, expect, it } from 'vitest'
import { notWired } from '../../../../src/server/lib/notWired'
import type { PageRepository } from '../../../../src/ports/pageRepository'

describe('notWired', () => {
  it('どのメソッドを呼んでも not wired: <name> を投げる（メソッド参照時点で throw する）', () => {
    const pages = notWired<PageRepository>('pages')
    expect(() => pages.findById).toThrow('not wired: pages')
  })

  it('名前が Proxy ごとに反映される', () => {
    const storage = notWired<PageRepository>('storage')
    expect(() => storage.create).toThrow('not wired: storage')
  })
})
