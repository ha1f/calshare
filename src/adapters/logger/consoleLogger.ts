import { MAX_LOG_ERROR_MESSAGE_LENGTH } from '../../core/config/limits'
import type { Logger } from '../../ports/logger'

/**
 * data.error に Error インスタンスが渡されたら { name, message }（message は MAX_LOG_ERROR_MESSAGE_LENGTH で切り詰め）に
 * 正規化し、それ以外の値は捨てる。呼び出し側が例外を渡しても入力内容がログに混ざらないようにするため（§9.6）。
 */
function normalizeData(
  data: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!data || !('error' in data)) return data
  const { error, ...rest } = data
  if (error instanceof Error) {
    return {
      ...rest,
      error: {
        name: error.name,
        message: error.message.slice(0, MAX_LOG_ERROR_MESSAGE_LENGTH),
      },
    }
  }
  return rest
}

function write(
  level: 'info' | 'warn' | 'error',
  event: string,
  data?: Record<string, unknown>,
): void {
  // data 側のキーで level / event が上書きされないよう、固定フィールドを後に置く
  console.log(JSON.stringify({ ...normalizeData(data), level, event }))
}

export const consoleLogger: Logger = {
  info: (event, data) => write('info', event, data),
  warn: (event, data) => write('warn', event, data),
  error: (event, data) => write('error', event, data),
}
