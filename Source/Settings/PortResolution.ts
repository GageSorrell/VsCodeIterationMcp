/**
 * @module vscode-iteration-mcp/Settings/PortResolution
 *
 * @file      PortResolution.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

import { ActionableError } from "../Core/Errors";
import { Result } from "effect";
import type { StructuredResult } from "../Core/Results";

export const PortOverrideStateKey = "vscodeIterationMcp.portOverride";

export type PortSettingSource = "workspace" | "user" | "default";
export type PortSource = "override" | PortSettingSource;

export interface PortSettingSnapshot
{
    value: unknown;
    source: PortSettingSource;
}

/** The requested port and every input that produced it; never the OS-assigned port. */
export interface PortResolution
{
    requestedPort: number;
    source: PortSource;
    settingPort: number;
    settingSource: PortSettingSource;
    overridePort?: number;
}

/** Minimal Memento surface so override persistence is testable without VS Code. */
export interface StateStore
{
    get<A>(key: string): A | undefined;
    update(key: string, value: unknown): Thenable<void>;
}

export function isValidPort(value: unknown): value is number
{
    return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 65535;
}

/** Parses user-entered port text. Blank succeeds with `undefined`, meaning "no override". */
export function parsePortInput(text: string): StructuredResult<number | undefined>
{
    const trimmed = text.trim();
    if (trimmed === "")
    {
        return Result.succeed(undefined);
    }

    if (!/^\d+$/.test(trimmed) || !isValidPort(Number(trimmed)))
    {
        return Result.fail({
            action: "Enter an integer from 0 through 65535, where 0 " +
            "requests automatic assignment, or leave it blank for no override.",
            code: "INVALID_ARGUMENT",
            message: `'${trimmed}' is not a valid port.`
        });
    }
    return Result.succeed(Number(trimmed));
}

/**
 * Applies the agreed precedence: sidebar workspace-state override, effective Workspace/User
 * setting, then the default. Invalid values fail rather than silently falling through.
 */
export function resolveRequestedPort(
    setting: PortSettingSnapshot,
    override: unknown
): StructuredResult<PortResolution>
{
    if (!isValidPort(setting.value))
    {
        return Result.fail({
            action: "Set vscodeIterationMcp.port to an integer from 0 through 65535 in Settings.",
            code: "INVALID_ARGUMENT",
            message: `The ${setting.source} value of vscodeIterationMcp.port ` +
            `(${JSON.stringify(setting.value)}) is not a valid port.`
        });
    }
    if (override !== undefined && !isValidPort(override))
    {
        return Result.fail({
            action: "Reset the port override, then apply an integer from 0 through 65535.",
            code: "INVALID_ARGUMENT",
            message: `The stored port override (${JSON.stringify(override)}) is not a valid port.`
        });
    }
    const base = { settingPort: setting.value, settingSource: setting.source };
    if (override !== undefined)
    {
        return Result.succeed({
            ...base,
            overridePort: override,
            requestedPort: override,
            source: "override"
        });
    }
    return Result.succeed({ ...base, requestedPort: setting.value, source: setting.source });
}

/** Persists the sidebar port override in workspace state, not Settings JSON. */
export class PortOverrideStore
{
    constructor(private readonly state: StateStore) {}

    get(): unknown
    {
        return this.state.get<unknown>(PortOverrideStateKey);
    }

    async set(port: number): Promise<void>
    {
        if (!isValidPort(port))
        {
            throw new ActionableError({
                action: "Use an integer from 0 through 65535.",
                code: "INVALID_ARGUMENT",
                message: `${JSON.stringify(port)} is not a valid port override.`
            });
        }
        await this.state.update(PortOverrideStateKey, port);
    }

    async reset(): Promise<void>
    {
        await this.state.update(PortOverrideStateKey, undefined);
    }
}
