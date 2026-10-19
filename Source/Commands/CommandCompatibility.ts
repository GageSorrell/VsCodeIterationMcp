/**
 * @module vscode-iteration-mcp/Commands/CommandCompatibility
 *
 * @file      CommandCompatibility.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

import * as vscode from "vscode";
import { ActionableError } from "../Core/Errors";

/** Keeps built-in command IDs and compatibility checks out of feature handlers. */
export async function executeBuiltInCommand<A>(command: string, ...args: Array<unknown>): Promise<A>
{
    const commands = await vscode.commands.getCommands(true);
    if (!commands.includes(command))
    {
        throw new ActionableError({
            action: "Check the VS Code version and retry in a desktop Extension Development Host.",
            code: "NOT_SUPPORTED",
            message: `VS Code command '${command}' is not available in this host.`
        });
    }
    return vscode.commands.executeCommand<A>(command, ...args);
}
