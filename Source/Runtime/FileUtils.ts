/**
 * @module vscode-iteration-mcp/Runtime/FileUtils
 *
 * @file      FileUtils.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";

/**
 * Writes through a sibling temp file and rename so readers
 * never see partial content.
 *
 * @throws {Error} TODO.
 */
export function writeFileAtomicSync(filePath: string, content: string, mode: number = 0o600): void
{
    fs.mkdirSync(path.dirname(filePath), { mode: 0o700, recursive: true });
    const tempPath = `${filePath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    try
    {
        fs.writeFileSync(tempPath, content, { encoding: "utf8", mode });
        fs.renameSync(tempPath, filePath);
    }
    catch (error: unknown)
    {
        fs.rmSync(tempPath, { force: true });
        throw error;
    }
}

/** Replaces a file only when its content differs; returns whether it was written. */
export function writeFileIfChangedSync(filePath: string, content: string, mode?: number): boolean
{
    try
    {
        if (fs.readFileSync(filePath, "utf8") === content)
        {
            return false;
        }
    }
    catch
    {
    // Missing or unreadable: write a fresh copy.
    }
    writeFileAtomicSync(filePath, content, mode);
    return true;
}
