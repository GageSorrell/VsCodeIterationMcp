/**
 * @module vscode-iteration-mcp/Extension
 *
 * @file      Extension.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

import type * as vscode from "vscode";
import { ExtensionController } from "./Lifecycle/ExtensionController";

let controller: ExtensionController | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void>
{
    controller = new ExtensionController(context);
    await controller.activate();
}

export function deactivate(): void
{
    controller?.dispose();
    controller = undefined;
}
