import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm'
import fontFixture from '../../fixtures/fonts/NotoSansJP-Regular.subset.otf'
import satori from 'satori/standalone'
import yogaWasm from 'satori/yoga.wasm'
import { describe, expect, it } from 'vitest'
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
    const renderer = createSatoriOgpRenderer(rendererOptions())
    await renderer.render(baseInput())
    const start = Date.now()
    const png = await renderer.render(baseInput({ title: '2回目' }))
    expectPng(png)
    // 初期化済みなら数十 ms 程度で終わるはず（実測値は PR 説明に記録する）
    expect(Date.now() - start).toBeLessThan(2000)
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
})
