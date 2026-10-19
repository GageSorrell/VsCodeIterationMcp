# Connection examples

These examples contain no bearer token. The extension writes the durable stdio registration through the **Add MCP Server to Agents...** command; external clients should use the same stable launcher pattern.

## Stdio, user scope

```json
{
  "mcpServers": {
    "vscode-iteration-mcp": {
      "type": "stdio",
      "command": "node",
      "args": [
        "<runtime-home>\\bin\\vscode-iteration-mcp-bridge.js",
        "--port",
        "0"
      ]
    }
  }
}
```

User and System registrations omit `--workspace`. The bridge resolves the owning open VS Code window from its current working directory and requested port. A Project registration adds:

```text
--workspace <absolute-workspace-root> --port <requested-port>
```

The requested port is the effective Settings/override value. `0` means automatic assignment; it is not replaced by the currently bound OS port in the configuration.

## HTTP, current window only

Use **Copy HTTP Client Configuration** while the server is running for a temporary connection. It includes a live bearer token and is intentionally not suitable for committing or long-term agent configuration. Prefer the stdio bridge for durable setup.

## First connection check

1. Open a trusted local workspace in VS Code.
2. Confirm the sidebar shows a running MCP Server and an actual bound port.
3. Use **Add MCP Server to Agents...** and choose the required agent(s), scope, and root.
4. Install the bundled skill with **Install Skill...** when the agent needs tool workflow guidance.
5. Ask the configured client to list tools and call `test_echo` in test mode, or use a supported debug/terminal tool in a normal development session.
