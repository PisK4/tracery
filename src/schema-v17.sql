CREATE TABLE IF NOT EXISTS session_title (
  conv_key      TEXT NOT NULL,
  source        TEXT NOT NULL,
  title         TEXT NOT NULL,
  manual        INTEGER NOT NULL DEFAULT 0,
  title_ms      INTEGER,
  observed_ms   INTEGER NOT NULL,
  evidence_json TEXT NOT NULL,
  PRIMARY KEY (conv_key, source)
) WITHOUT ROWID;