import type { IdGenerator } from '../../ports/idGenerator'

/**
 * 決定的な連番から ID を組み立てるテスト用の生成器。文字は `isValidPageId` を満たす
 * Crockford Base32 の許可文字だけを使う（`i` `l` `o` `u` を含まない）
 */
export function createFakeIdGenerator(): IdGenerator {
  let pageIdCount = 0
  let editTokenCount = 0
  let uuidCount = 0

  return {
    generatePageId: () => `page${String(++pageIdCount).padStart(8, '0')}`,
    generateEditToken: () =>
      `edittoken-fake-${String(++editTokenCount).padStart(4, '0')}`.padEnd(43, '0'),
    generateUuid: () => {
      const n = String(++uuidCount).padStart(12, '0')
      return `00000000-0000-4000-8000-${n}`
    },
  }
}
