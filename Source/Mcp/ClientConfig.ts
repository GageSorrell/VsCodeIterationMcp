/**
 * @module vscode-iteration-mcp/Mcp/ClientConfig
 *
 * @file      ClientConfig.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

import { McpServerName } from "./Server";

export interface HttpClientConfigInput
{
    endpoint: string;
    token: string;
}

export interface StdioClientConfigInput
{
    launcherPath: string;
    requestedPort: number;
    workspace?: string;
}

/** Direct HTTP configuration. It embeds this window's live token and stops working when the window closes. */
export function buildHttpClientConfig({ endpoint, token }: HttpClientConfigInput): object
{
    return {
        mcpServers: {
            [ McpServerName ]:
            {
                headers: { Authorization: `Bearer ${token}` },
                type: "http",
                url: endpoint
            }
        }
    };
}

export function buildBridgeArgs({
    launcherPath,
    requestedPort,
    workspace
}: StdioClientConfigInput): Array<string>
{
    return [
        launcherPath,
        ...(workspace !== undefined
            ? [ "--workspace",
                workspace
            ]
            : [ ]
        ),
        "--port",
        String(requestedPort)
    ];
}

/**
 * Durable stdio configuration through the stable launcher. It carries only the requested port
 * and workspace; the bridge resolves the live endpoint and token at connect time.
 */
export function buildStdioClientConfig(input: StdioClientConfigInput): object
{
    return {
        mcpServers: {
            [ McpServerName ]:
            {
                args: buildBridgeArgs(input),
                command: "node",
                type: "stdio"
            }
        }
    };
}
