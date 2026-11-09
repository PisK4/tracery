/**
 * 全量 profile 参考导出：向本机 Tracery 发一段合成会话的 OTLP/HTTP JSON traces。
 * 用法：bun scripts/otlp-full-profile-export.ts --endpoint http://127.0.0.1:8320 --token <otlp.token 的 base64url>
 * 只产合成数据；service.name=tracery-reference 已在 SPAN_RULES 登记。
 *
 * 接收端核对（src/http.ts 的 /v1/traces + src/sources/otlp/decode.ts 的 JSON 分支）：
 * - content-type 必须是 application/json（白名单两值之一），规范化后按 ';' 去参数；
 * - 认证头是 `Authorization: Bearer <token>`，token 为数据目录 otlp.token 的 base64url；
 * - 属性是 [{key,value:{stringValue|intValue|arrayValue}}]，intValue 允许数字或十进制字符串；
 * - traceId/spanId 是十六进制串，start/endTimeUnixNano 是十进制字符串；
 * - service.name 落在 resourceSpans[].resource.attributes。
 */
export {};
const args = process.argv.slice(2);
function arg(name: string): string {
  const i = args.indexOf(name);
  if (i === -1 || args[i + 1] === undefined) throw new Error(`missing ${name}`);
  return args[i + 1]!;
}
const endpoint = arg('--endpoint').replace(/\/+$/, '');
const token = arg('--token');
const session = `ref-${Date.now()}`;
const now = Date.now();
const traceId = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
function spanId(): string {
  return [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('');
}
const inputMessages = JSON.stringify([{ role: 'user', parts: [{ type: 'text', content: 'synthetic reference question' }] }]);
const outputMessages = JSON.stringify([{ role: 'assistant', parts: [
  { type: 'text', content: 'synthetic reference answer' },
  { type: 'tool_call', id: 'call_ref_1', name: 'reference_tool', arguments: { q: 'synth' } },
] }]);
function kv(key: string, value: string): { key: string; value: { stringValue: string } };
function kv(key: string, value: number): { key: string; value: { intValue: string } };
function kv(key: string, value: string | number): { key: string; value: { stringValue: string } | { intValue: string } } {
  return typeof value === 'number'
    ? { key, value: { intValue: String(value) } }
    : { key, value: { stringValue: value } };
}
const payload = { resourceSpans: [{
  resource: { attributes: [kv('service.name', 'tracery-reference')] },
  scopeSpans: [{ scope: { name: 'tracery-reference-export' }, spans: [{
    traceId, spanId: spanId(), name: 'chat reference-model', kind: 3,
    startTimeUnixNano: String(now * 1_000_000), endTimeUnixNano: String((now + 1500) * 1_000_000),
    status: { code: 1 },
    attributes: [
      kv('gen_ai.operation.name', 'chat'), kv('gen_ai.conversation.id', session),
      kv('gen_ai.request.model', 'reference-model'), kv('gen_ai.response.model', 'reference-model'),
      kv('gen_ai.response.id', `chatcmpl-ref-${session}`),
      // finish_reasons 是数组：stopOf 取首个字符串，写进回复信封的 stop_reason，
      // replyShapeOf 的 semconv 分支靠它把带 tool_call 的答复判成 tools。
      { key: 'gen_ai.response.finish_reasons', value: { arrayValue: { values: [{ stringValue: 'stop' }] } } },
      kv('gen_ai.usage.input_tokens', 100), kv('gen_ai.usage.output_tokens', 20),
      kv('gen_ai.usage.cache_read.input_tokens', 0), kv('gen_ai.usage.cache_creation.input_tokens', 0),
      kv('gen_ai.input.messages', inputMessages), kv('gen_ai.output.messages', outputMessages),
    ],
  }] }],
}] };
const res = await fetch(`${endpoint}/v1/traces`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify(payload),
});
console.log(res.status, await res.text());
if (!res.ok) process.exit(1);
