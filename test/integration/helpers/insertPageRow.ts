/** events を持たない pages 行だけを直接 INSERT する。FK 制約を満たす下準備や、events 0 行の InvariantViolation を再現するのに使う */
export async function insertPageRow(db: D1Database, id: string, now: Date): Promise<void> {
  const iso = now.toISOString()
  await db
    .prepare(
      `INSERT INTO pages (id, edit_token_hash, raw_text, source, creator_ip_hash, creator_device_id, created_at, updated_at, expires_at)
       VALUES (?, 'token-hash', 'raw', 'direct', 'ip-hash', 'device-id', ?, ?, ?)`,
    )
    .bind(id, iso, iso, iso)
    .run()
}
