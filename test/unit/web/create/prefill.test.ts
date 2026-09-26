import { describe, expect, it } from 'vitest'
import { resolveCreateSource, resolvePrefillFromSearch } from '../../../../src/web/create/prefill'
import type { ParseContext } from '../../../../src/core/parse/types'

const ctx: ParseContext = { now: new Date('2026-09-20T00:00:00.000Z') }

function source(search: string): ReturnType<typeof resolveCreateSource> {
  return resolveCreateSource(search, resolvePrefillFromSearch(search, ctx))
}

describe('resolveCreateSource', () => {
  it('何もなければ direct', () => {
    expect(source('')).toBe('direct')
  })

  it('ref=detail_cta を優先する', () => {
    expect(source('?ref=detail_cta&text=懇親会')).toBe('detail_cta')
  })

  it('構造化パラメータに使える値があれば prefill', () => {
    expect(source('?text=懇親会')).toBe('prefill')
  })

  it('q だけでも prefill', () => {
    expect(source(`?q=${encodeURIComponent('9/20 懇親会')}`)).toBe('prefill')
  })

  it('不正な dates だけでは prefill にしない（プリフィルが捨てて画面に何も反映されないため）', () => {
    expect(source('?dates=garbage')).toBe('direct')
  })
})
