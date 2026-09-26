import satori, { init as initSatori } from 'satori/standalone'
import type { Font } from 'satori/standalone'
import { initWasm, Resvg } from '@resvg/resvg-wasm'
import { OGP_IMAGE_HEIGHT, OGP_IMAGE_WIDTH } from '../../core/config/limits'
import { formatDateLabel } from '../../core/time/jst'
import type { OgpInput, OgpRenderer } from '../../ports/ogpRenderer'
import type { PageRecord } from '../../ports/pageRepository'
import { ogpTemplate } from './ogpTemplate'

const FONT_NAME = 'Noto Sans JP'
// タイトルは 2 行相当に切り詰める（§2.5）。実際の折返しは ogpTemplate の lineClamp が行うため、
// ここでは極端に長い入力（MAX_TITLE_LENGTH まで許容される）でのレイアウト計算コストを抑える目的
const TITLE_MAX_CHARS = 60

export interface SatoriOgpRendererOptions {
  /**
   * yoga と resvg の wasm。Workers では `import` した WebAssembly.Module を返す。
   * ArrayBuffer を返す経路は Node 専用（Workers は WebAssembly.compile(bytes) を許可しない）
   */
  loadWasm: () => Promise<{
    yoga: WebAssembly.Module | ArrayBuffer
    resvg: WebAssembly.Module | ArrayBuffer
  }>
  loadFont: () => Promise<ArrayBuffer>
}

interface Initialized {
  // satori は SatoriOptions.fonts を WeakMap のキーにしてパース結果をキャッシュする
  // （node_modules/satori/dist/standalone.js の FontLoader 呼び出し箇所で確認済み）。
  // render のたびに新しい配列リテラルを渡すとキャッシュが効かず毎回パースし直しになるため、
  // この配列を使い回す
  fonts: Font[]
}

/**
 * wasm の初期化とフォント読み込みは初回 render 時にだけ行い、結果をモジュールスコープでメモ化する
 * （§2.5）。isolate が再利用される限り 2 回目以降の render はここを通らない。
 * 失敗した Promise はメモ化しない（次の render で再試行できるようにする）
 */
let initPromise: Promise<Initialized> | null = null

function init(options: SatoriOgpRendererOptions): Promise<Initialized> {
  if (initPromise === null) {
    initPromise = (async () => {
      const [{ yoga, resvg }, font] = await Promise.all([options.loadWasm(), options.loadFont()])
      await Promise.all([initSatori(yoga), initWasm(resvg)])
      return { fonts: [{ name: FONT_NAME, data: font, weight: 400, style: 'normal' }] }
    })()
    initPromise.catch(() => {
      initPromise = null
    })
  }
  return initPromise
}

/** satori/resvg で OGP 画像（PNG）を生成する（design.md §2.5・§11.5） */
export function createSatoriOgpRenderer(options: SatoriOgpRendererOptions): OgpRenderer {
  return {
    render: async (input: OgpInput): Promise<Uint8Array> => {
      const { fonts } = await init(options)
      const svg = await satori(ogpTemplate(input), {
        width: OGP_IMAGE_WIDTH,
        height: OGP_IMAGE_HEIGHT,
        fonts,
      })
      const resvg = new Resvg(svg, { font: { loadSystemFonts: false } })
      const rendered = resvg.render()
      const png = rendered.asPng()
      rendered.free()
      resvg.free()
      return png
    },
  }
}

/** 絵文字・異体字セレクタ・制御文字を除去する。サブセットフォント（JIS 第 1 水準）に無い漢字までは
 * 判別できないため、そこは satori が該当グリフを描かないことで例外にならずに吸収する想定（§2.5） */
function stripUnsupportedChars(rawText: string): string {
  return rawText
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}]/gu, '')
    .replace(/[\u{200D}]/gu, '') // ZWJ（絵文字の連結に使われる。他は削除済みなので単独で残ると意味を持たない）
    .replace(/\p{Cc}/gu, '')
    .trim()
}

/** PageRecord から OgpRenderer の入力を組む（design.md §2.5・§11.5）。空になったタイトルは
 * 描かない（テンプレート側が日時だけを描く。§14.1「OGP のフォント未収録文字」） */
export function toOgpInput(page: PageRecord, serviceName: string): OgpInput {
  const location = page.event.location !== null ? stripUnsupportedChars(page.event.location) : ''
  // .slice は UTF-16 コード単位で切るためサロゲートペア（𠮟 等）を割る可能性がある。
  // Array.from はコードポイント単位で反復するので割らない
  const title = Array.from(stripUnsupportedChars(page.event.title))
    .slice(0, TITLE_MAX_CHARS)
    .join('')
  return {
    title,
    dateLabel: formatDateLabel(page.event),
    location: location !== '' ? location : null,
    serviceName,
  }
}
