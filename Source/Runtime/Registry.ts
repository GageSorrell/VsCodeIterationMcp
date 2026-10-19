/**
 * @module vscode-iteration-mcp/Runtime/Registry
 *
 * @file      Registry.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { writeFileAtomicSync } from "./FileUtils";

export const RuntimeRecordSchema = 1;

/**
 * Live connection data for one VS Code window. It lives only in the per-user runtime home
 * and is removed when the window's server stops; agent configuration never contains it.
 */
export interface RuntimeRecord
{
    schema: typeof RuntimeRecordSchema;
    windowId: string;
    pid: number;
    endpoint: string;
    requestedPort: number;
    port: number;
    token: string;
    workspaceFolders: Array<string>;
    workspaceFile?: string;
    extensionVersion: string;
    startedAt: string;
}

export function isProcessAlive(pid: number): boolean
{
    try
    {
        process.kill(pid, 0);
        return true;
    }
    catch (error: unknown)
    {
    // EPERM means the process exists but belongs to someone else.
        return (error as NodeJS.ErrnoException).code === "EPERM";
    }
}

function isRuntimeRecord(value: unknown): value is RuntimeRecord
{
    const record = value as Partial<RuntimeRecord> | null;
    return typeof record === "object" && record !== null
    && record.schema === RuntimeRecordSchema
    && typeof record.windowId === "string"
    && typeof record.pid === "number"
    && typeof record.endpoint === "string"
    && typeof record.port === "number"
    && typeof record.requestedPort === "number"
    && typeof record.token === "string"
    && Array.isArray(record.workspaceFolders);
}

export class RuntimeRegistry
{
    constructor(private readonly windowsDir: string) {}

    private recordPath(windowId: string): string
    {
        return path.join(this.windowsDir, `${windowId}.json`);
    }

    write(record: RuntimeRecord): void
    {
        writeFileAtomicSync(this.recordPath(record.windowId), `${JSON.stringify(record, undefined, 2)}\n`);
    }

    /** Synchronous so deactivation can release discovery data without awaiting. */
    remove(windowId: string): void
    {
        fs.rmSync(this.recordPath(windowId), { force: true });
    }

    /** Lists records whose owning extension host is still alive; malformed files are skipped. */
    list(isAlive: (pid: number) => boolean = isProcessAlive): Array<RuntimeRecord>
    {
        let names: Array<string>;
        try
        {
            names = fs.readdirSync(this.windowsDir);
        }
        catch
        {
            return [];
        }
        const records: Array<RuntimeRecord> = [ ];
        for (const name of names.filter((entry: string) => entry.endsWith(".json")))
        {
            try
            {
                const parsed: unknown = JSON.parse(fs.readFileSync(path.join(this.windowsDir, name), "utf8"));
                if (isRuntimeRecord(parsed) && isAlive(parsed.pid))
                {
                    records.push(parsed);
                }
            }
            catch
            {
                // Partially removed or foreign files are not discovery candidates.
            }
        }
        return records;
    }

    /** Removes records left behind by extension hosts that exited without cleanup. */
    pruneStale(isAlive: (pid: number) => boolean = isProcessAlive): void
    {
        let names: Array<string>;
        try
        {
            names = fs.readdirSync(this.windowsDir);
        }
        catch
        {
            return;
        }
        for (const name of names.filter((entry: string) => entry.endsWith(".json")))
        {
            const filePath = path.join(this.windowsDir, name);
            try
            {
                const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
                if (isRuntimeRecord(parsed) && !isAlive(parsed.pid))
                {
                    fs.rmSync(filePath, { force: true });
                }
            }
            catch
            {
                // Leave unreadable files alone; they may be mid-write by another window.
            }
        }
    }
}
