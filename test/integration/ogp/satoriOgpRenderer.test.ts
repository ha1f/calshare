import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm'
import fontFixture from '../../fixtures/fonts/NotoSansJP-Regular.subset.otf'
import satori from 'satori/standalone'
import type { Font } from 'satori/standalone'
import yogaWasm from 'satori/yoga.wasm'
import { describe, expect, it, vi } from 'vitest'
import { createSatoriOgpRenderer, toOgpInput } from '../../../src/adapters/ogp/satoriOgpRenderer'
import { ogpTemplate } from '../../../src/adapters/ogp/ogpTemplate'
import { OGP_IMAGE_HEIGHT, OGP_IMAGE_WIDTH } from '../../../src/core/config/limits'
import type { OgpInput } from '../../../src/ports/ogpRenderer'
import type { PageRecord } from '../../../src/ports/pageRepository'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function rendererOptions() {
  return {
    loadWasm: async () => ({ yoga: yogaWasm, resvg: resvgWasm }),
    loadFont: async () => fontFixture,
  }
}

function baseInput(overrides: Partial<OgpInput> = {}): OgpInput {
  return {
    title: '飲み会',
    dateLabel: '9月20日(日) 19:00〜21:00',
    location: '渋谷',
    serviceName: 'calshare',
    ...overrides,
  }
}

/** PNG の IHDR チャンク（シグネチャ直後の 8 バイト目から）に幅・高さがビッグエンディアンで入っている */
function pngSize(png: Uint8Array): { width: number; height: number } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

function expectPng(png: Uint8Array) {
  expect(Array.from(png.slice(0, PNG_SIGNATURE.length))).toEqual(PNG_SIGNATURE)
  expect(pngSize(png)).toEqual({ width: OGP_IMAGE_WIDTH, height: OGP_IMAGE_HEIGHT })
}

function page(overrides: { title?: string; location?: string | null } = {}): PageRecord {
  return {
    event: {
      title: overrides.title ?? '飲み会',
      location: 'location' in overrides ? overrides.location : '渋谷',
      memo: null,
      start: new Date('2026-09-20T10:00:00.000Z'),
      end: new Date('2026-09-20T11:00:00.000Z'),
      isAllDay: false,
    },
  } as unknown as PageRecord
}

describe('createSatoriOgpRenderer', () => {
  it('日本語を含む入力から PNG が返る', async () => {
    const renderer = createSatoriOgpRenderer(rendererOptions())
    const png = await renderer.render(baseInput())
    expectPng(png)
  })

  it('未収録文字（絵文字・第 1 水準外の漢字）を含む入力でも例外にならず PNG が返る', async () => {
    const renderer = createSatoriOgpRenderer(rendererOptions())
    // 「𠮟」は第一水準外の漢字（サロゲートペア）、絵文字は toOgpInput が除去する
    const input = toOgpInput(page({ title: '🎉パーティー 𠮟る会 &"<script>' }), 'calshare')
    const png = await renderer.render(input)
    expectPng(png)
  })

  it('title に HTML/SVG の特殊文字を含めても SVG 中間出力に文字列がそのまま現れない', async () => {
    const input = baseInput({ title: '<script>alert(1)</script>&"' })
    // PNG は satori が中間生成する SVG から resvg が描画するため、注入されていないことは
    // PNG の生バイトではなく SVG 文字列そのものを見て確認する必要がある。
    // yoga の init は他のテストで済ませているが単独実行でも通るよう明示的に 1 回 render しておく
    const renderer = createSatoriOgpRenderer(rendererOptions())
    await renderer.render(input)

    const svg = await satori(ogpTemplate(input), {
      width: OGP_IMAGE_WIDTH,
      height: OGP_IMAGE_HEIGHT,
      fonts: [{ name: 'Noto Sans JP', data: fontFixture, weight: 400, style: 'normal' }],
    })
    expect(svg).not.toContain('<script')
    expect(svg).not.toContain('alert(1)')
    expect(svg).not.toContain('&"')
  })

  it('2 回目の render はフォント・wasm を再初期化せず結果を返す（メモ化の確認）', async () => {
    // init はモジュールスコープでメモ化されるため、このファイルの他のテストで既に
    // 初期化済みのことがある。呼び出し回数の絶対値ではなく「1 回目と 2 回目で増えないこと」を見る
    const options = rendererOptions()
    const loadWasm = vi.fn(options.loadWasm)
    const loadFont = vi.fn(options.loadFont)
    const renderer = createSatoriOgpRenderer({ loadWasm, loadFont })

    await renderer.render(baseInput())
    const callsAfterFirst = { wasm: loadWasm.mock.calls.length, font: loadFont.mock.calls.length }

    const png = await renderer.render(baseInput({ title: '2回目' }))
    expectPng(png)
    expect(loadWasm.mock.calls.length).toBe(callsAfterFirst.wasm)
    expect(loadFont.mock.calls.length).toBe(callsAfterFirst.font)
  })

  it('場所が長くても場所の枠は 2 行分の高さを超えない（2 行 clamp の固定、レビュー指摘の反例）', async () => {
    // satori は各テキストノードを <mask id="satori_om-id-N"><rect .../></mask> で描画し、
    // rect の height がその要素の実際のレンダリング高さになる。見出し・タイトル・日時ラベル・
    // 場所の順（ogpTemplate の children 順）なので 4 番目（index 3）が場所の外接矩形
    const fonts: Font[] = [
      { name: 'Noto Sans JP', data: fontFixture, weight: 400, style: 'normal' },
    ]
    const render = (input: OgpInput) =>
      satori(ogpTemplate(input), { width: OGP_IMAGE_WIDTH, height: OGP_IMAGE_HEIGHT, fonts })
    const rectHeights = (svg: string) =>
      [
        ...svg.matchAll(
          /<mask id="satori_om-id-\d+"><rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="([\d.]+)"/g,
        ),
      ].map((m) => Number(m[1]))

    const oneLineSvg = await render(baseInput())
    const twoLinesHeight = rectHeights(oneLineSvg)[3] // '渋谷'（1 行）の高さ

    const longLocationSvg = await render(baseInput({ location: 'あ'.repeat(200) }))
    const longLocationHeight = rectHeights(longLocationSvg)[3]

    // clamp が効いていなければ 200 文字は 6 行前後（1 行の高さの約 6 倍）になる
    expect(longLocationHeight).toBeLessThanOrEqual(twoLinesHeight * 2 + 1)
  })

  it('タイトルが 2 行に収まる長さでも日時ラベルの位置は変わらない（2 行 clamp の固定）', async () => {
    const fonts: Font[] = [
      { name: 'Noto Sans JP', data: fontFixture, weight: 400, style: 'normal' },
    ]
    const render = (input: OgpInput) =>
      satori(ogpTemplate(input), { width: OGP_IMAGE_WIDTH, height: OGP_IMAGE_HEIGHT, fonts })
    const dateLabelY = (svg: string) => {
      const rects = [...svg.matchAll(/<mask id="satori_om-id-\d+"><rect x="[\d.]+" y="([\d.]+)"/g)]
      return rects[2]?.[1]
    }

    const oneLineTitleSvg = await render(baseInput())
    // '亜' を width 1072px・fontSize 64 で並べるとちょうど 2 行に折り返す長さ（clamp の上限と一致）
    const twoLineTitleSvg = await render(baseInput({ title: '亜'.repeat(32) }))

    expect(dateLabelY(twoLineTitleSvg)).not.toBe(dateLabelY(oneLineTitleSvg)) // 1 行→2 行は伸びてよい

    // それ以上長くしても（clamp が無ければ 4 行以上に伸びるはずが）日時ラベルの位置は 2 行分から動かない
    const fourLineTitleSvg = await render(baseInput({ title: '亜'.repeat(64) }))
    expect(dateLabelY(fourLineTitleSvg)).toBe(dateLabelY(twoLineTitleSvg))
  })
})

describe('toOgpInput', () => {
  it('絵文字を除去する', () => {
    const input = toOgpInput(page({ title: '🎉飲み会🎉' }), 'calshare')
    expect(input.title).toBe('飲み会')
  })

  it('location が null なら null のまま', () => {
    const input = toOgpInput(page({ location: null }), 'calshare')
    expect(input.location).toBeNull()
  })

  it('serviceName をそのまま渡す', () => {
    const input = toOgpInput(page(), 'calshare')
    expect(input.serviceName).toBe('calshare')
  })

  it('書式制御文字（RLO・ZWSP・BOM・RLM 等の Cf）を除去する', () => {
    // U+202E RLO, U+200B ZWSP, U+FEFF BOM, U+200F RLM
    const input = toOgpInput(page({ title: 'a‮b​c﻿d‏e' }), 'calshare')
    expect(input.title).toBe('abcde')
  })
})
