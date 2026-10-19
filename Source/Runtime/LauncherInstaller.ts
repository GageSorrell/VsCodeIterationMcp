/**
 * @module vscode-iteration-mcp/Runtime/LauncherInstaller
 *
 * @file      LauncherInstaller.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { RuntimePaths } from "./RuntimePaths";
import { writeFileIfChangedSync } from "./FileUtils";

export function getBundledBridgePath(extensionRoot: string): string
{
    return path.join(extensionRoot, "dist", "bridge", "main.js");
}

/** Native machine-wide launcher location used by System agent registrations. */
export function getSharedLauncherPath(
    env: NodeJS.ProcessEnv = process.env,
    platform: NodeJS.Platform = process.platform
): string
{
    if (platform !== "win32")
    {
        return path.join("/usr", "local", "bin", "vscode-iteration-mcp-bridge.js");
    }
    return path.join(
        env.ProgramData ?? path.join(env.SystemDrive ?? "C:", "ProgramData"),
        "vscode-iteration-mcp",
        "bin",
        "vscode-iteration-mcp-bridge.js"
    );
}

/**
 * Copies the stable launcher to the per-user runtime home and points it at this extension
 * version's bridge. Agent configuration references only the launcher path.
 */
export function installLauncher(paths: RuntimePaths, extensionRoot: string, extensionVersion: string): void
{
    const source = fs.readFileSync(path.join(extensionRoot, "dist", "bridge", "launcher.js"), "utf8")
        .replace(/\r?\n\/\/# sourceMappingURL=.*$/m, "");
    writeFileIfChangedSync(paths.launcherPath, source, 0o644);
    const pointer = { bridgePath: getBundledBridgePath(extensionRoot), extensionVersion };
    writeFileIfChangedSync(paths.bridgePointerPath, `${JSON.stringify(pointer, undefined, 2)}\n`, 0o644);
}

/** Installs only the dependency-free launcher; it resolves the invoking user's runtime home. */
export function installSharedLauncher(extensionRoot: string, launcherPath: string): void
{
    const source = fs.readFileSync(path.join(extensionRoot, "dist", "bridge", "launcher.js"), "utf8")
        .replace(/\r?\n\/\/# sourceMappingURL=.*$/m, "");
    writeFileIfChangedSync(launcherPath, source, 0o644);
}
