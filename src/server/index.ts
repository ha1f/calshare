import { createApp } from './app'
import { buildDeps } from './deps'
import type { Env } from './env'

export default {
  fetch: (req: Request, env: Env, ctx: ExecutionContext) =>
    createApp(buildDeps(env)).fetch(req, env, ctx),
}
