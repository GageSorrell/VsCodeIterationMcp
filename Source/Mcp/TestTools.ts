/**
 * @module vscode-iteration-mcp/Mcp/TestTools
 *
 * @file      TestTools.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

import { Schema, type ToolDefinition, defineTool } from "../Core/Validation";
import { Result } from "effect";

export const TestModeEnv = "VSCODE_ITERATION_MCP_TEST";
export const TestEchoTool = "test_echo";

/**
 * Diagnostic handler used to verify transports end to end. It is registered only in test
 * hosts so that production clients see just the planned tool set.
 */
export function createTestTools(windowId: string): Array<ToolDefinition>
{
    return [
        defineTool({
            description: "Test-only: echo a message with the identity of the VS Code window that handled it.",
            handler: ({ message }: { readonly message: string; }) => Result.succeed({ message, windowId }),
            input: Schema.Struct({ message: Schema.String }),
            name: TestEchoTool
        })
    ];
}

export function isTestMode(env: NodeJS.ProcessEnv = process.env): boolean
{
    return env[TestModeEnv] === "1";
}
