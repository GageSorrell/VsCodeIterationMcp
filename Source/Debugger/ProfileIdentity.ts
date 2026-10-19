/**
 * @module vscode-iteration-mcp/Debugger/ProfileIdentity
 *
 * @file      ProfileIdentity.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

export type DebugProfileKind = "configuration" | "compound";

export interface ProfileIdentityParts
{
    readonly source: "launch.json";
    readonly folderUri: string;
    readonly kind: DebugProfileKind;
    readonly index: number;
    readonly name: string;
}

const Prefix = "vscode-iteration-mcp";

/**
 * Produces a readable, deterministic ID. The source and encoded folder URI are deliberately
 * part of the ID so equal names in different folders cannot collide.
 */
export function createProfileId(parts: ProfileIdentityParts): string
{
    return [
        Prefix,
        parts.source,
        encodeURIComponent(parts.folderUri),
        parts.kind,
        String(parts.index),
        encodeURIComponent(parts.name)
    ].join(":");
}

export function parseProfileId(id: string): ProfileIdentityParts | undefined
{
    const parts = id.split(":");
    if (parts.length !== 6 || parts[0] !== Prefix || parts[1] !== "launch.json")
    {
        return undefined;
    }
    const kind = parts[3];
    const index = Number(parts[4]);
    if ((kind !== "configuration" && kind !== "compound") || !Number.isInteger(index) || index < 0)
    {
        return undefined;
    }
    try
    {
        return {
            folderUri: decodeURIComponent(parts[2]),
            index,
            kind,
            name: decodeURIComponent(parts[5]),
            source: "launch.json"
        };
    }
    catch
    {
        return undefined;
    }
}
