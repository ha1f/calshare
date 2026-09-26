import { resolvePrefill, type PrefillResult } from '../../core/prefill/resolvePrefill'
import type { ParseContext } from '../../core/parse/types'
import type { CreateSource } from '../../core/types'

const PREFILL_PARAM_NAMES = ['text', 'dates', 'location', 'details', 'q'] as const

/** 値が空（trim 後空文字）のクエリパラメータは「無い」ものとして扱う（§5.8） */
function readParam(params: URLSearchParams, name: string): string | undefined {
  const value = params.get(name)
  if (value === null || value.trim() === '') return undefined
  return value
}

/** `/new` のクエリ文字列から作成画面の初期値を組む（§5.8） */
export function resolvePrefillFromSearch(search: string, ctx: ParseContext): PrefillResult {
  const params = new URLSearchParams(search)
  return resolvePrefill(
    {
      text: readParam(params, 'text'),
      dates: readParam(params, 'dates'),
      location: readParam(params, 'location'),
      details: readParam(params, 'details'),
      q: readParam(params, 'q'),
    },
    ctx,
  )
}

/**
 * 作成の流入元（§6.1）。`ref=detail_cta` を優先し、次にプリフィルパラメータに使える値が
 * あれば `prefill`、それ以外は `direct`
 */
export function resolveCreateSource(search: string): CreateSource {
  const params = new URLSearchParams(search)
  if (params.get('ref') === 'detail_cta') return 'detail_cta'
  const hasUsablePrefillParam = PREFILL_PARAM_NAMES.some(
    (name) => readParam(params, name) !== undefined,
  )
  return hasUsablePrefillParam ? 'prefill' : 'direct'
}
