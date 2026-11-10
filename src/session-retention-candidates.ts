/**
 * 会话保留候选：删除引擎与只读预览共用的年龄、顺序与过期口径。
 *
 * 候选 = 过期的完整会话：按 conv_key 分组，年龄取 MAX(started_ms)，
 * `MAX(started_ms) < cutoffMs` 才算过期；conv_key IS NULL 的孤立请求不构成会话。
 * 最旧优先（last_ms ASC, conv_key ASC），删除与预览都从这里取同一份清单。
 */

import type { Database } from 'bun:sqlite';

export type RetentionCandidate = {
  conv_key: string;
  last_ms: number;
  request_count: number;
};

export const SESSION_RETENTION_CANDIDATE_SQL = `
  SELECT conv_key, MAX(started_ms) AS last_ms, COUNT(*) AS request_count
  FROM request
  WHERE conv_key IS NOT NULL
  GROUP BY conv_key
  HAVING MAX(started_ms) < ?
  ORDER BY last_ms ASC, conv_key ASC
  LIMIT ?`;

export function sessionRetentionCandidates(
  db: Database, cutoffMs: number, limit: number,
): RetentionCandidate[] {
  return db.query<RetentionCandidate, [number, number]>(
    SESSION_RETENTION_CANDIDATE_SQL,
  ).all(cutoffMs, limit);
}
