import { resolvePrefill, type PrefillResult } from '../../core/prefill/resolvePrefill'
import type { ParseContext } from '../../core/parse/types'
import type { CreateSource } from '../../core/types'

export type { PrefillResult }

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
 * 作成の流入元（§6.1）。`ref=detail_cta` を優先し、次にプリフィルの結果に画面へ反映できた
 * 値（`manualKeys` かこれに由来する `rawText`）があれば `prefill`、それ以外は `direct`。
 * `dates` のように値はあってもプリフィルが不正として捨てた場合は数えない
 */
export function resolveCreateSource(search: string, prefill: PrefillResult): CreateSource {
  const params = new URLSearchParams(search)
  if (params.get('ref') === 'detail_cta') return 'detail_cta'
  const hasUsablePrefillValue = prefill.manualKeys.length > 0 || prefill.rawText.trim() !== ''
  return hasUsablePrefillValue ? 'prefill' : 'direct'
}
