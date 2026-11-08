/**
 * 工具结果里「本次调用启动了哪个子代理」的强指纹。
 *
 * 只认启动回执，不认普通的 agentId 字样：Claude Code 的异步 Agent 回执以
 * `Async agent launched successfully` 开头，紧跟 `agentId: <17 位 hex>`。
 * 两段同时命中才返回 id；读文件读到的同形文本、ListAgents 的清单都不会命中。
 * 已知格式变更时改这里，并在回执文案迁移的同批验证里重跑派生提取测试。
 */
export function spawnedAgentRef(text: string): string | null {
  if (!text.includes('Async agent launched successfully')) return null;
  const match = /agentId:\s*([0-9a-f]{17})\b/.exec(text);
  return match?.[1] ?? null;
}

/** 会启动子代理的工具名：与启动回执指纹配合，缺一不认。 */
const SPAWN_TOOLS: ReadonlySet<string> = new Set(['Agent']);

export function isSpawnTool(toolName: string | null): boolean {
  return toolName !== null && SPAWN_TOOLS.has(toolName);
}
