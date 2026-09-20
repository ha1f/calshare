export interface IdGenerator {
  /** 12 文字 Crockford Base32 小文字 */
  generatePageId(): string
  /** base64url 43 文字 */
  generateEditToken(): string
  generateUuid(): string
}
