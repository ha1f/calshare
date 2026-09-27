import type { Context } from 'hono'
import type { ApiError } from '../../core/api/types'
import type { Env } from '../env'
import { ICS_EXTENSION } from './ics'
import { NotFound } from '../views/NotFound'

/**
 * app.notFound の実体（docs/guidelines.md §5.4）。どのルートにも一致しなかったリクエストをパスの形で 3 通りに分ける。
 * `/api/*` は JSON、`.ics` は Hono 既定と同じプレーンテキスト（ics.ts の c.notFound() もここに来る）、
 * それ以外は NotFound ビューの HTML にする。
 */
export function handleNotFound(
  c: Context<{ Bindings: Env }>,
  serviceName: string,
): Response | Promise<Response> {
  if (c.req.path.startsWith('/api/')) {
    const body: ApiError = { code: 'NOT_FOUND', message: 'not found' }
    return c.json(body, 404)
  }
  if (c.req.path.endsWith(ICS_EXTENSION)) {
    return c.text('404 Not Found', 404)
  }
  return c.html(<NotFound serviceName={serviceName} />, 404)
}
