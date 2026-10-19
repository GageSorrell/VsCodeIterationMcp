# Compatibility matrix

This matrix records the targets verified for Milestone 10. It describes the implementation and local validation, not Marketplace availability.

| Area | Supported / verified behavior | Limitation or compatibility gate |
| --- | --- | --- |
| Operating system | Windows desktop, x64 test environment | macOS, Linux, remote, browser, and remote extension hosts are outside v1 |
| VS Code | 1.142.0 Extension Development Host and packaged-extension test | The manifest requires VS Code 1.142.0 or later |
| Node.js | Node.js available to the extension host and external stdio bridge | External stdio agents must be able to execute `node` and the stable bridge launcher |
| MCP HTTP | Loopback Streamable HTTP with per-window bearer authentication | The endpoint and token are local runtime state; HTTP copy configuration is not durable across reloads |
| MCP stdio | Stable launcher, per-user runtime discovery, workspace-aware routing, automatic and fixed requested ports | Ambiguous workspace ownership is rejected rather than routed arbitrarily |
| Workspace trust | Trusted local workspaces start the server and expose the full workflow | Untrusted workspaces do not start the listener until trust is granted |
| Claude Code Project/User | `.mcp.json` and `~/.claude.json` support native `mcpServers` merges | Managed System policy can suppress Project/User entries |
| Claude Code System | `C:\Program Files\ClaudeCode\managed-mcp.json` and managed skill destination are implemented | Administrator permissions and managed MCP exclusive-control effects require explicit confirmation |
| Codex Project/User | `.codex/config.toml` and `$CODEX_HOME/config.toml` support native `mcp_servers` merges | Existing configuration syntax outside the supported MCP table is preserved but not interpreted as an activation guarantee |
| Codex System | Retained as an explicit unsupported result on native Windows | No verified native Windows machine-wide destination was available; no guessed path is written |
| Bundled skill | Claude Code and Codex Project/User skill copies are installed and inspected independently by root and scope | Modified, unreadable, partial, and unsupported results remain visible and are not silently overwritten |

System-scope writes were not performed against the developer's live machine configuration during automated validation. The Codex Windows System result is intentionally recorded as unsupported until a disposable native installation verifies its discovery path.
