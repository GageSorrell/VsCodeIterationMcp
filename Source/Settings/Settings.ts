/**
 * @module vscode-iteration-mcp/Settings/Settings
 *
 * @file      Settings.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

import * as vscode from "vscode";
import type { PortSettingSnapshot } from "./PortResolution";

export const SettingSection = "vscodeIterationMcp";
export const SettingPortKey = "port";
export const SettingPort = `${SettingSection}.${SettingPortKey}`;

export { isValidPort } from "./PortResolution";

/** Reads the effective window-scoped port setting and the level that supplied it. */
export function readPortSetting(): PortSettingSnapshot
{
    const inspected = vscode.workspace.getConfiguration(SettingSection).inspect<unknown>(SettingPortKey);
    if (inspected?.workspaceValue !== undefined)
    {
        return {
            source: "workspace",
            value: inspected.workspaceValue
        };
    }
    if (inspected?.globalValue !== undefined)
    {
        return {
            source: "user",
            value: inspected.globalValue
        };
    }
    return { source: "default", value: inspected?.defaultValue ?? 0  };
}
