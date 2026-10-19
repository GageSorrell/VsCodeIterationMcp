/**
 * @module vscode-iteration-mcp/Mcp/Server
 *
 * @file      Server.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Result } from "effect";
import type { SchemaOutput } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { ToolDefinition } from "../Core/Validation";
import { toCallToolResult } from "./ToolResults";

export const McpServerName = "vscode-iteration-mcp";
export const McpServerVersion = "0.1.0";

/**
 * Creates one protocol server; the HTTP host creates one per client session. Tools are served
 * through the low-level SDK handlers so their schemas come from Effect rather than Zod.
 */
export function createMcpServer(tools: ReadonlyArray<ToolDefinition> = []): Server
{
    const server = new Server(
        { name: McpServerName, version: McpServerVersion },
        { capabilities: { tools: { listChanged: true } } }
    );

    const byName = new Map(tools.map((tool: ToolDefinition) => [ tool.name, tool ]));

    server.setRequestHandler(ListToolsRequestSchema, () => ({
        tools: tools.map(({ name, description, inputSchema }: ToolDefinition) =>
            ({ description, inputSchema, name }))
    }));

    type CallToolRequest = SchemaOutput<typeof CallToolRequestSchema>;
    server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) =>
    {
        const tool = byName.get(request.params.name);
        if (!tool)
        {
            return toCallToolResult(Result.fail({
                action: "Call tools/list to discover the tools this server provides.",
                code: "NOT_FOUND" as const,
                message: `Unknown tool '${request.params.name}'.`
            }));
        }
        return toCallToolResult(await tool.call(request.params.arguments));
    });

    return server;
}
