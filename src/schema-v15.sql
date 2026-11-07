-- ATC schema v15: 会话列表可见性/agent 过滤与全库 Agent 目录的覆盖索引。
-- Additive only —— v14 库单事务原地升级：建索引后推进 user_version。
--
-- 阶段一 GROUP BY conv_key 后的 HAVING 参与链/agent 谓词要读 purpose_chain 与
-- agent，现有 i_req_session_time 不含这两列会逐行回表。本索引覆盖
-- conv_key/purpose_chain/agent/started_ms，让列表阶段一与 listSessionAgents
-- 免回表聚合。计划器是否选中由 EXPLAIN 断言钉住，实测成本见提案 note。

CREATE INDEX IF NOT EXISTS i_req_session_visible ON request(conv_key, purpose_chain, agent, started_ms DESC);