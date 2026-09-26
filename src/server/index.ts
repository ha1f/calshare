import { createApp } from './app'
import { buildDeps } from './deps'
import type { Env } from './env'
import { runGc } from './scheduled/gc'

export default {
  fetch: (req: Request, env: Env, ctx: ExecutionContext) =>
    createApp(buildDeps(env)).fetch(req, env, ctx),
  scheduled: (_controller: ScheduledController, env: Env, ctx: ExecutionContext) =>
    ctx.waitUntil(runGc(buildDeps(env))),
}
