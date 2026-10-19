/**
 * @module vscode-iteration-mcp/Debugger/DebuggerTools
 *
 * @file      DebuggerTools.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

import {
    type DebugControlAction,
    type DebugStartResult,
    type DebugStatus,
    type DebuggerService
} from "./DebuggerService";
import { Schema, type ToolDefinition, defineTool } from "../Core/Validation";
import { Result } from "effect";

export const DebugListProfilesTool = "debug_list_profiles";
export const DebugGetSelectedProfileTool = "debug_get_selected_profile";
export const DebugStartTool = "debug_start";
export const DebugGetStatusTool = "debug_get_status";
export const DebugControlTool = "debug_control";

export function createDebuggerTools(service: DebuggerService): Array<ToolDefinition>
{
    return [
        defineTool({
            description: "List saved launch.json configurations and compounds across all workspace folders.",
            handler: () => Result.succeed(service.listProfiles()),
            input: Schema.Struct({}),
            name: DebugListProfilesTool
        }),
        defineTool({
            description: "Report the explicit UNSUPPORTED result for the currently selected launch profile.",
            handler: () => service.getSelectedProfile(),
            input: Schema.Struct({}),
            name: DebugGetSelectedProfileTool
        }),
        defineTool({
            description: "Start debugging with VS Code's current selection or a saved profile ID.",
            handler: ({ profileId }: { readonly profileId?: string | undefined; }) =>
                service.start(profileId).then((result: DebugStartResult) => Result.succeed(result)),
            input: Schema.Struct({ profileId: Schema.optional(Schema.String) }),
            name: DebugStartTool
        }),
        defineTool({
            description: "Report the currently focused debug session, " +
            "observed execution state, thread, and adapter capabilities.",
            handler: () => Result.succeed(service.getStatus()),
            input: Schema.Struct({}),
            name: DebugGetStatusTool
        }),
        defineTool({
            description: "Control the currently focused debug session and thread using an " +
            "explicit supported action.",
            handler: ({ action }: { readonly action: DebugControlAction; }) =>
                service.control(action as DebugControlAction)
                    .then((result: DebugStatus) => Result.succeed(result)),
            input: Schema.Struct({
                action: Schema.Literals([
                    "continue",
                    "pause",
                    "step_over",
                    "step_into",
                    "step_out",
                    "restart",
                    "stop",
                    "disconnect",
                    "disconnect_and_suspend",
                    "step_back",
                    "reverse_continue"
                ])
            }),
            name: DebugControlTool
        })
    ];
}
