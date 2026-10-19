---
name: vscode-iteration-mcp
description: Run and debug projects and operate integrated terminals in an open VS Code workspace through VS Code Iteration MCP. Use when the user wants launch-profile control, debugger execution controls, terminal input, or retained terminal output in VS Code.
---

# VS Code Iteration MCP

Use the connected VS Code Iteration MCP server for the user's open workspace. Discover the server's available tools and schemas before calling them; client-specific tool-name prefixes can vary. If the server is unavailable, report that and direct the user to the extension's sidebar server status and Add MCP Server to Agents action. Installing this skill does not itself connect the server.

## Launch and debug

- Use `debug_list_profiles` to find saved launch configurations and compounds. Use returned profile IDs to disambiguate equal names across folders.
- To launch what the user has selected in VS Code, call `debug_start` without `profileId`. To launch a specific saved profile, supply its returned ID.
- `debug_get_selected_profile` reports `UNSUPPORTED` in the standard extension. Do not claim that the active session, last launch, or first listed profile identifies the UI selection.
- Use `debug_get_status` to inspect the active session and observed state. Unknown state is not evidence that the target is running or paused.
- Use `debug_control` for continue, pause, stepping, restart, stop, disconnect, disconnect-and-suspend, and supported reverse-debugging actions. Controls target the currently focused debug session and thread.
- Preserve the user's distinction between stop and disconnect: disconnect is intended to detach, while stop may terminate the debug target. Do not replace an unsupported action with a different lifecycle action without user direction.
- Respect errors and adapter capabilities. Starting a project may invoke VS Code tasks or interactive prompts; distinguish a pending/accepted request from a confirmed launch or completed action.

## Terminals

- Use `terminal_list` to identify sessions by ID; names can repeat. Use `terminal_focus` to select a specific session or focus the current one.
- Use `terminal_list_profiles` to inspect configured profiles. Its `complete: false` result means auto-detected profiles may be absent; do not claim the list covers every available profile.
- Use `terminal_create` without `profileName` for the VS Code default, or supply a profile name for a specific shell. Creation focuses the new terminal.
- `terminal_send_text` sends to the active terminal. `pressEnter` defaults to `false`; set it to `true` only when execution or an Enter keypress is intended. Empty text with `pressEnter: true` sends Enter alone.
- Input and reads require an existing active terminal. If a requested session is missing or closes, report the error rather than sending input to another session.
- Use `terminal_read` to retrieve retained text, including available scrollback. Supply a positive integer `maxLines` for the last N lines; omit it when the full retained buffer is needed.
- Reads may focus the terminal, replace its selection, and temporarily use clipboard text. They cannot recover discarded scrollback or preserve every clipboard format. Treat returned output as a snapshot, not proof that a command has completed or succeeded.

## Connection and scope

Ports and authentication belong to extension/agent configuration, not to this skill. Do not hard-code a port, copy credentials into project instructions, or select an arbitrary open VS Code window when workspace routing is ambiguous.

The extension sidebar shows server status, port settings, agent registration, and skill installation separately. If connection settings need an update, use the extension's setup workflow for the intended scope/root. A skill or config file existing on disk does not prove that the agent has loaded it; respect native agent trust, restart requirements, and managed policy.
