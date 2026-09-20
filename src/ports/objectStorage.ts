export interface ObjectStorage {
  /** キーは ics/{pageId}.ics（version を含めない。§1.3） */
  putIcs(pageId: string, body: string): Promise<void>
  /** 無ければ null。routes/ics.ts は null かつ isServable なページなら buildIcsForPage で再生成し putIcs してから返す（作成時の PUT 失敗の自己修復、§2.3） */
  getIcs(pageId: string): Promise<string | null>
  putOgpImage(pageId: string, version: number, png: Uint8Array): Promise<void>
  getOgpImage(pageId: string, version: number): Promise<Uint8Array | null>
  putOgpFailureMarker(pageId: string, version: number, ttlSeconds: number): Promise<void>
  getOgpFailureMarker(pageId: string, version: number): Promise<boolean>
  getFont(key: string): Promise<ArrayBuffer | null>
  deleteAllForPage(pageId: string): Promise<void>
}
