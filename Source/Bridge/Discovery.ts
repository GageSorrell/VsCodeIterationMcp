/**
 * @module vscode-iteration-mcp/Bridge/Discovery
 *
 * @file      Discovery.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

import * as path from "node:path";
import { Result } from "effect";
import type { RuntimeRecord } from "../Runtime/Registry";
import type { StructuredResult } from "../Core/Results";

export interface DiscoveryCriteria
{
    /** Project root, `.code-workspace` file, or the client's working directory. */
    workspace: string;
    /** Requested port from agent configuration; 0 accepts whichever port the window bound. */
    requestedPort: number;
    platform?: NodeJS.Platform;
}

/** Fails with NOT_FOUND (no owning window, or a port mismatch) or AMBIGUOUS. */
export type DiscoveryResult = StructuredResult<RuntimeRecord>;

function normalize(value: string, platform: NodeJS.Platform): string
{
    const pathApi = platform === "win32" ? path.win32 : path.posix;
    let resolved = pathApi.resolve(value);
    const root = pathApi.parse(resolved).root;
    while (resolved.length > root.length && /[\\/]$/.test(resolved))
    {
        resolved = resolved.slice(0, -1);
    }
    return platform === "win32" ? resolved.toLowerCase() : resolved;
}

function contains(folder: string, target: string, platform: NodeJS.Platform): boolean
{
    if (folder === target)
    {
        return true;
    }
    const separator = platform === "win32" ? "\\" : "/";
    const prefix = folder.endsWith(separator) ? folder : `${folder}${separator}`;
    return target.startsWith(prefix);
}

/** Scores how specifically a window owns the target; undefined means it does not. */
function matchScore(record: RuntimeRecord, target: string, platform: NodeJS.Platform): number | undefined
{
    if (record.workspaceFile !== undefined && normalize(record.workspaceFile, platform) === target)
    {
        return Number.MAX_SAFE_INTEGER;
    }
    let best: number | undefined;
    for (const folder of record.workspaceFolders)
    {
        const normalized = normalize(folder, platform);
        if (contains(normalized, target, platform) && (best === undefined || normalized.length > best))
        {
            best = normalized.length;
        }
    }
    return best;
}

function describe(record: RuntimeRecord): string
{
    const folders = record.workspaceFolders.length > 0 ? record.workspaceFolders.join(", ") : "(no folders)";
    return `${folders} on port ${record.port}`;
}

/**
 * Picks the single window that owns the workspace. The most specific folder match wins;
 * equally specific matches are ambiguous and never resolved by guessing.
 */
export function selectWindow(
    records: ReadonlyArray<RuntimeRecord>,
    criteria: DiscoveryCriteria
): DiscoveryResult
{
    const platform = criteria.platform ?? process.platform;
    const target = normalize(criteria.workspace, platform);
    interface Entry
    {
        readonly record: RuntimeRecord;
        readonly score: number | undefined;
    }

    const owners = records
        .map((record: RuntimeRecord) => ({ record, score: matchScore(record, target, platform) }))
        .filter((entry: Entry): entry is { record: RuntimeRecord; score: number } =>
            entry.score !== undefined
        );

    if (owners.length === 0)
    {
        const open = records.length > 0
            ? ` Open windows: ${records.map(describe).join("; ")}.`
            : " No VS Code Iteration MCP server is running for this user.";
        return Result.fail({
            code: "NOT_FOUND",
            message: "No VS Code window with a running VS Code Iteration MCP server contains " +
            `'${criteria.workspace}'.${open}` +
            " Open the workspace in a trusted VS Code window, or pass --workspace with the project root."
        });
    }

    interface Owner
    {
        readonly record: RuntimeRecord;
        readonly score: number;
    }

    const candidates = criteria.requestedPort === 0
        ? owners
        : owners.filter(({ record }: Owner) => record.port === criteria.requestedPort);

    if (candidates.length === 0)
    {
        return Result.fail({
            code: "NOT_FOUND",
            message: `The VS Code window for '${criteria.workspace}' is listening on ` +
            `${owners.map(({ record }: Owner) => record.port).join(", ")}, `
        + `but this configuration requests port ${criteria.requestedPort}.`
        + " Update the agent configuration or the window's vscodeIterationMcp.port setting so they match."
        });
    }

    const bestScore = Math.max(...candidates.map(({ score }: Owner) => score));
    const best = candidates.filter(({ score }: Owner) => score === bestScore);
    if (best.length > 1)
    {
        return Result.fail({
            code: "AMBIGUOUS",
            message: "More than one VS Code window contains " +
            `'${criteria.workspace}': ${best.map(({ record }: Owner) => describe(record)).join("; ")}.`
        + " Close the duplicate window, configure distinct fixed ports, or pass a more specific --workspace."
        });
    }
    return Result.succeed(best[0].record);
}
