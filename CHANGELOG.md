# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning starts at 0.1.0 when the first release is tagged; until then everything lands under Unreleased.

## [Unreleased]

No tagged release yet. This section describes the state of `master`.

### Added

- **OTLP as the general ingestion entry point.** An OTLP/HTTP receiver accepts `/v1/traces` and `/v1/logs` in protobuf and JSON, built on OTel GenAI semantic conventions with no private keys. Native export shapes from Claude Code, OMP and Codex CLI are registered alongside a full-profile path for self-built agents, custom gateways and third-party harnesses; the [exporter profile](docs/otlp-exporter-profile.md) holds the contract and a versioned mapping commitment.
- **A shared ingest core with unified owner claim.** Hook bodies, OTLP spans and local session files run through one orchestration — dedupe before claim, evidence registration, body chunking and derived-state marking — so one call stays one request row with evidence from every source.
- **Ten local agent session adapters.** Claude Code, Codex, droid, DSH, Hermes, Grok, WorkBuddy, Zcode, OMP and Pi transcripts are discovered on a timer and rebuilt into per-call traces. Forks, subagents, compressed Codex twins and per-agent usage conventions are handled by each adapter.
- **Session reading.** A three-pane interface: session list, per-step trace, and a right pane with readings, raw bodies, tool pairing, routing detail and Plugin tabs. Subagent reading views default to the main chain, offer all-actors and per-`S#` views, and link an Agent tool call to the subagent it launched.
- **Message-level diffing.** Requests are stored message by message and compared by semantic fingerprint, distinguishing a new branch from a broken chain.
- **Context treemap.** Prompt decomposition laid out by token area — tool definitions, skills, system prompt, memory, conversation, tool results — with fixed overhead and cache hit rate.
- **Reasoning and execution timings** kept as separate concepts: per-request reasoning spans and per-call execution spans.
- **Turn bands and session summaries** — tool counts, failures, interrupts, paths written and read, skills, cache hits, context peaks, and coverage gaps.
- **A full-database agent directory** with visibility and per-agent filters, backed by a covering index.
- **Plugin mechanism.** One registry entry gives a capability its rail tab and the Parsers that adapt each agent's tool shape; local community packages run in an isolated worker. Todo is the first Plugin.
- **Offline maintenance CLI** — backup, restore, verify, dedupe, `otlp-replay`, rebuild, reparse, capacity and retention.
- **Synthetic demo server** covering empty states, windowed pagination, missing channels and turn pairing.
- **Cross-platform data directory.** macOS uses `~/Library/Application Support`, everything else follows `XDG_DATA_HOME`.
- **CI** running typecheck and the full test suite on every push and pull request.

### Notes

- Bodies are reclaimed against a budget: 10 GB of bodies, 16 GB total, oldest bodies first at 90% of budget. Reclaimed bodies cannot be restored.
- The collector is not a proxy. It records what the gateway, the harness exporter or a local session file provides; it intercepts nothing.
- Data stays local: loopback-only listener, directory 0700, files 0600, credentials redacted by rule, no upload. Tests use synthetic data only.
