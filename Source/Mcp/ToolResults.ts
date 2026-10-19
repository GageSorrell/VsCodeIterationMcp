/**
 * @module vscode-iteration-mcp/Mcp/ToolResults
 *
 * @file      ToolResults.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

import { type StructuredResult, toWireResult } from "../Core/Results";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Result } from "effect";

/** Maps the shared structured result model onto an MCP tool result. */
export function toCallToolResult<A>(result: StructuredResult<A>): CallToolResult
{
    const wire = toWireResult(result);
    return {
        content: [ { text: JSON.stringify(wire), type: "text" } ],
        isError: Result.isFailure(result),
        structuredContent: wire as unknown as Record<string, unknown>
    };
}
