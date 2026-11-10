/**
 * 会话保留守卫的共享 SQL 片段：删除侧与预览侧必须对「来源缺口」用同一判据，
 * 否则预览说命中、删除却照删，或反过来。
 *
 * `convKeySql` 只能是代码内写死的列表达式（`r.conv_key=?`、`r.conv_key=t.conv_key`），
 * 不拼接任何外部输入；包含几个 `?` 由调用方按同一顺序绑定。
 */

/**
 * 会话是否还挂着开放/可恢复的来源缺口。账本与路由按证据 ref_key 的
 * `['file', generation, offset]` 关联；本地会话按 sort_key 的 generation 关联。
 * 关联不上的缺口不猜归属，按「没有缺口」处理。
 */
export function openSourceGapSql(convKeySql: string): string {
  return `EXISTS (
    SELECT 1 FROM source_gap g
    WHERE g.state IN ('open','resumable')
      AND (
        EXISTS (
          SELECT 1 FROM request r
          JOIN request_evidence e ON e.req_id=r.req_id
          WHERE ${convKeySql}
            AND e.source_kind IN ('ledger','route')
            AND e.source_kind=g.source_kind
            AND json_valid(e.ref_key)
            AND json_extract(e.ref_key,'$[1]')=g.file_generation
        )
        OR EXISTS (
          SELECT 1 FROM request r
          WHERE ${convKeySql} AND r.sort_key IS NOT NULL
            AND instr(r.sort_key,'|')>0
            AND substr(r.sort_key,1,instr(r.sort_key,'|')-1)=g.file_generation
        )
        OR (
          g.source_kind='route'
          AND EXISTS (
            SELECT 1 FROM request r JOIN request_evidence e ON e.req_id=r.req_id
            WHERE ${convKeySql} AND e.source_kind='route'
          )
        )
      )
  )`;
}
