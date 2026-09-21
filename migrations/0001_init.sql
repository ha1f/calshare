CREATE TABLE pages (
  id TEXT PRIMARY KEY,                    -- 公開 URL の ID（§4.2）
  owner_id TEXT NULL,                     -- Phase 3 の余地。Phase 1 は常に NULL。FK は付けない（users が無いため）
  edit_token_hash TEXT NOT NULL,          -- 編集トークンの SHA-256（hex）。生トークンは保存しない
  raw_text TEXT NOT NULL,                 -- 作成時の入力全文（編集画面の初期表示・不具合調査用）
  issuer_name TEXT NULL,                  -- Phase 3 の発行者スロット。Phase 1 は常に NULL
  issuer_logo_url TEXT NULL,
  status TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'hidden'（運用者が非表示にした）
  report_count INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,     -- 編集のたびに +1。OGP のキーと ics SEQUENCE（= version - 1）に使う
  previous_snapshot TEXT NULL,            -- 直近の編集前の日時（ChangeSnapshot を JSON で保持。変更バナー用、§3.5）。48 時間後に GC が NULL にする
  changed_at TEXT NULL,                   -- previous_snapshot を書いた日時（ISO8601 UTC）
  source TEXT NOT NULL DEFAULT 'direct',  -- 作成の流入元 'direct' | 'detail_cta' | 'prefill'（転換率の計測用、§9.6）
  creator_ip_hash TEXT NOT NULL,          -- 作成時の ip_hash（§9.3 と同じ pepper 付き HMAC。生 IP は持たない）。スパム波の一括非表示に使う（§9.4）
  creator_device_id TEXT NOT NULL,        -- 作成時の device_id。同上
  created_at TEXT NOT NULL,               -- ISO8601 UTC
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL                -- 保持期限。GC はこの列だけを見る
);
CREATE INDEX idx_pages_expires_at ON pages(expires_at);
CREATE INDEX idx_pages_creator_ip_hash ON pages(creator_ip_hash);
CREATE INDEX idx_pages_creator_device_id ON pages(creator_device_id);

CREATE TABLE events (
  id TEXT PRIMARY KEY,                    -- ics UID の一部になる安定 ID（UUID v4）
  page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,  -- Phase 1 は常に 0
  title TEXT NOT NULL,
  location TEXT NULL,
  memo TEXT NULL,
  is_all_day INTEGER NOT NULL DEFAULT 0,  -- 0/1
  start_at TEXT NULL,                     -- ISO8601 UTC。日時未確定の下書きは NULL
  end_at TEXT NULL,                       -- 終日は排他的翌日 00:00 JST を UTC で保持
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_events_page_id ON events(page_id);

CREATE TABLE rate_limit_counters (
  scope TEXT NOT NULL,                    -- 'create' | 'report'
  bucket_key TEXT NOT NULL,               -- 'ip:{ip_hash}' または 'device:{device_id}'
  window_kind TEXT NOT NULL,              -- 'hour' | 'day'。`window` は SQLite 3.25 以降のキーワードなので列名に使わない
  window_start TEXT NOT NULL,             -- 窓の開始時刻（ISO8601 UTC、窓幅で切り捨て）
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, bucket_key, window_kind, window_start)
);

CREATE TABLE reports (
  id TEXT PRIMARY KEY,                    -- UUID v4
  page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,                   -- 'spam' | 'personal_info' | 'inappropriate' | 'other'
  comment TEXT NULL,
  ip_hash TEXT NOT NULL,                  -- 同一通報者の重複排除に使う（生 IP は持たない）
  created_at TEXT NOT NULL
);
CREATE INDEX idx_reports_page_id ON reports(page_id);
