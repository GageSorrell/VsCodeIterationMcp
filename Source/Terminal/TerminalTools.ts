/**
 * @module vscode-iteration-mcp/Terminal/TerminalTools
 *
 * @file      TerminalTools.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

import { Result } from "effect";
import { Schema, type ToolDefinition, defineTool } from "../Core/Validation";
import type { TerminalService } from "./TerminalService";

export const TerminalListTool = "terminal_list";
export const TerminalFocusTool = "terminal_focus";
export const TerminalListProfilesTool = "terminal_list_profiles";
export const TerminalCreateTool = "terminal_create";
export const TerminalSendTextTool = "terminal_send_text";
export const TerminalReadTool = "terminal_read";

export function createTerminalTools(service: TerminalService): Array<ToolDefinition>
{
    return [
        defineTool({
            description: "List open terminal sessions with extension-assigned IDs and active status.",
            handler: () => Result.succeed(service.list()),
            input: Schema.Struct({}),
            name: TerminalListTool
        }),
        defineTool({
            description: "Focus the specified terminal session, or the current terminal when no ID is supplied.",
            handler: ({ terminalId }) => service.focus(terminalId).then((result) => Result.succeed(result)),
            input: Schema.Struct({ terminalId: Schema.optional(Schema.String) }),
            name: TerminalFocusTool
        }),
        defineTool({
            description: "List configured Windows terminal profiles and the configured default. Auto-detected profiles may be absent.",
            handler: () => Result.succeed(service.listProfiles()),
            input: Schema.Struct({}),
            name: TerminalListProfilesTool
        }),
        defineTool({
            description: "Create and focus a terminal using VS Code's default profile or a configured named profile.",
            handler: ({ profileName }) => service.create(profileName).then((result) => Result.succeed(result)),
            input: Schema.Struct({ profileName: Schema.optional(Schema.String) }),
            name: TerminalCreateTool
        }),
        defineTool({
            description: "Send text to the active terminal, optionally pressing Enter after the text.",
            handler: ({ text, pressEnter }) =>
                service.sendText(text, pressEnter ?? false).then((result) => Result.succeed(result)),
            input: Schema.Struct({
                pressEnter: Schema.optional(Schema.Boolean),
                text: Schema.String
            }),
            name: TerminalSendTextTool
        }),
        defineTool({
            description: "Read retained scrollback from the active terminal. Reads may focus the panel, replace the selection, and temporarily use clipboard text.",
            handler: ({ maxLines }) => service.read(maxLines).then((result) => Result.succeed(result)),
            input: Schema.Struct({
                maxLines: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0)))
            }),
            name: TerminalReadTool
        })
    ];
}
