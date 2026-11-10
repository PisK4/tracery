-- v18: session-level tombstones for whole-session retention.
-- One row per purged conv_key; ingest skips calls started before purged_at.
CREATE TABLE IF NOT EXISTS purged_conversation (
  conv_key       TEXT PRIMARY KEY,
  purged_at      INTEGER NOT NULL,
  first_ms       INTEGER,
  last_ms        INTEGER,
  request_count  INTEGER NOT NULL,
  reason         TEXT NOT NULL,
  source_kinds   TEXT NOT NULL
) WITHOUT ROWID;

-- Whole-session retention's survivor checks look up requests by session and by the
-- generation prefix of sort_key; both were full table scans without these indexes.
CREATE INDEX IF NOT EXISTS i_req_session ON request(session) WHERE session IS NOT NULL;
CREATE INDEX IF NOT EXISTS i_req_sort_generation
  ON request(substr(sort_key,1,instr(sort_key,'|')-1))
  WHERE sort_key IS NOT NULL AND instr(sort_key,'|')>0;
-- Raw-session survivor checks and cursor resets filter by generation and scan
-- other session ids of that generation; this keeps them off the full table.
CREATE INDEX IF NOT EXISTS i_raw_session_event_generation
  ON raw_session_event(source_kind, file_generation, session_id);
