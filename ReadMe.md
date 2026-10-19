# VS Code Iteration MCP

VS Code Iteration MCP gives local MCP clients a controlled connection to the active Windows VS Code workspace. It exposes the debugger and integrated terminals through a local, authenticated Streamable HTTP server and a durable Node.js stdio bridge.

The extension is designed for local development with an agent that needs to launch a project, inspect or control a debug session, create and operate terminals, and read retained terminal output without storing an ephemeral HTTP token in agent configuration.

> This repository contains a reviewed local VSIX and publication preparation. It is not published to the Visual Studio Marketplace. The release-candidate package identity is `gage-sorrell.vscode-iteration-mcp`.

## Verified target

- Windows desktop x64.
- VS Code 1.142.0 or later.
- A Node.js executable available to the external stdio client. The extension host itself supplies the packaged runtime dependencies.
- Trusted local workspaces. The extension may be installed in an untrusted workspace, but its MCP listener does not start until trust is granted.

macOS, Linux, remote extension hosts, browser workspaces, and virtual workspaces are outside the verified v1 target.

## Install locally

The current repository build is intentionally local-only:

1. Build a clean package with `npm ci` followed by `npm run package`.
2. In VS Code, run **Extensions: Install from VSIX...** and select `dist/vscode-iteration-mcp.vsix`.
3. Open a trusted local workspace and select the **VS Code Iteration MCP** icon in the Activity Bar.

The package is also reproducible in Windows CI. No Marketplace login, upload, or publication is required for local installation.

## Quick start

1. Open a trusted workspace containing the project you want to operate.
2. Open the **VS Code Iteration MCP** Activity Bar view. The Setup sidebar shows server status, the effective port, agent configuration, and skill status.
3. Leave `vscodeIterationMcp.port` at `0` for automatic assignment, or set a fixed port in Settings. A workspace sidebar override takes precedence over Settings and can be reset independently.
4. Use **Add MCP Server to Agents...** to select Claude Code and/or Codex, then choose Project, User, or System scope. Multi-root workspaces prompt for the exact root.
5. Use **Install Skill...** to copy the bundled workflow guidance to the selected agent scopes.
6. Ask the configured client to list tools, call `test_echo` in a test session, or use a supported debugger/terminal workflow.

## Sidebar and commands

The primary sidebar keeps setup state visible without exposing bearer credentials:

![Sanitized release-candidate UI reference showing server, port, agents, and skill sections](docs/images/sidebar.png)

- **MCP Server** — running/error state, requested port, actual bound port, restart/start/stop, and manual refresh.
- **Port override** — apply, reset, and open the `vscodeIterationMcp.port` Settings entry.
- **Agents** — native configuration status by agent, scope, and workspace root, including mismatch and policy results.
- **Skill** — bundled-skill status and install/update action.

The Command Palette provides the same actions: start/stop/restart/status, copy HTTP or stdio configuration, add MCP server to agents, apply project workspace settings, install the skill, and manage the port.

## MCP connections

HTTP is intended for the current VS Code window. Use **Copy HTTP Client Configuration** only while the server is running; it contains a live bearer token and should not be committed.

Stdio is the durable option. **Add MCP Server to Agents...** writes a registration that invokes the stable bridge launcher. The bridge discovers the current window endpoint and credentials at connection time, so extension reloads and assigned-port changes do not leave an old token in agent configuration. See [docs/ConnectionExamples.md](docs/ConnectionExamples.md).

## Tools

The extension exposes these supported MCP tools:

### Debugger

- `debug_list_profiles` lists saved launch configurations and compounds with workspace-aware IDs.
- `debug_get_selected_profile` intentionally returns `UNSUPPORTED`; it never guesses from the active session.
- `debug_start` starts the selected UI profile when no ID is supplied, or a saved profile by ID.
- `debug_get_status` reports observed session state.
- `debug_control` supports continue, pause, step over/into/out, restart, stop, disconnect, disconnect-and-suspend, and explicit unsupported reverse-debugging results.

### Terminals

- `terminal_list`, `terminal_focus`, and `terminal_list_profiles` inspect sessions and configured Windows profiles.
- `terminal_create` creates a default or named profile terminal.
- `terminal_send_text` sends text with optional Enter execution.
- `terminal_read` reads retained scrollback, optionally limited to the last N lines, while preserving the user's clipboard when safe.

Tool schemas validate inputs and return structured, actionable errors. Terminal scrollback is limited to what VS Code still retains; discarded history cannot be recovered.

## Agent setup, scopes, and roots

The extension supports Claude Code and Codex at Project, User, and System scopes where native Windows discovery is verified:

![Sanitized release-candidate UI reference showing agent and scope selection](docs/images/setup-prompts.png)

- **Project** writes the selected workspace root and never silently writes another root.
- **User** writes the current user's native configuration.
- **System** is policy-sensitive. Claude Code's managed MCP file requires administrator access and can suppress project/user overrides. Native Windows Codex System discovery remains explicitly unsupported and is shown as such rather than guessed.

Configuration merges preserve unrelated content. Existing skills are compared before update, and modified or unreadable copies remain visible in status. The bundled skill contains no credentials or assigned ports.

## Port and trust behavior

The effective requested port is resolved as sidebar workspace override, then VS Code Workspace/User setting, then the default `0`. A fixed occupied port is an error; the listener never falls back to another port. Each VS Code window receives its own loopback endpoint and bearer credential. Untrusted workspaces do not start the listener.

## Compatibility and troubleshooting

See [docs/Compatibility.md](docs/Compatibility.md) for the verified matrix and known limits. Common checks:

- If the server is stopped, trust the workspace and use **Start** or reload the window.
- If a fixed port fails, free it or reset the override; the error is intentional and no fallback port is selected.
- If an agent cannot connect, prefer the durable stdio registration and confirm that `node` is on the external client's PATH.
- If a project mismatch is shown, use **Use Workspace Settings at Project Scope** for the affected root and agent.
- If a skill is modified or partial, use **Install / Update Skill...** and review each per-agent result.
- If terminal output is missing, remember that only retained VS Code scrollback is available and clipboard formats can limit recovery.

## Data handling and cleanup

The extension listens only on `127.0.0.1`. It does not send workspace contents to a hosted service. HTTP credentials are generated per window and kept in runtime state; durable agent files contain bridge arguments, not the ephemeral token. The terminal reader temporarily uses the VS Code clipboard and restores it only when the copied value is still current.

Uninstalling the extension removes its code, but it does not remove agent registrations or installed skills because those files may be shared with other tools. Remove the `vscode-iteration-mcp` entry from the selected native agent files and delete the installed `vscode-iteration-mcp` skill directories if they are no longer wanted. Runtime discovery files are disposable and can be removed after all bridge clients stop.

## Support

Report reproducible bugs and compatibility issues at [GitHub Issues](https://github.com/GageSorrell/VsCodeIterationMcp/issues). Include VS Code version, Windows architecture, extension version, relevant scope/root, and redacted logs. Never include bearer tokens, credentials, or private workspace contents. See [`Support.md`](Support.md).

## Development

```powershell
npm ci
npm run check
npm test
npm run test:integration
npm run test:vsix
npm run test:clean-profile
npm run validate:release
npm run package
npm run inspect:vsix
```

The test suites use isolated homes and disposable workspaces. `test:vsix` extracts the generated package and runs the Extension Development Host suite against packaged files. Windows CI builds and uploads the VSIX artifact without publication credentials. See [docs/Validation.md](docs/Validation.md) and [docs/Publishing.md](docs/Publishing.md).

Contributions should preserve the stable VS Code API boundary, explicit unsupported results, scope/root isolation, and local-only credential handling. The repository uses the `Master` branch.

## License

MIT. See [License.md](License.md) and [ThirdPartyNotices.md](ThirdPartyNotices.md).
