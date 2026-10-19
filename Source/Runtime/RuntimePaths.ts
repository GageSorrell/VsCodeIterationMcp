/**
 * @module vscode-iteration-mcp/Runtime/RuntimePaths
 *
 * @file      RuntimePaths.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

import * as os from "node:os";
import * as path from "node:path";

/** Overrides the per-user runtime home; used for isolated tests. */
export const RuntimeHomeEnv = "VSCODE_ITERATION_MCP_HOME";
export const LauncherFileName = "vscode-iteration-mcp-bridge.js";

/**
 * Per-OS-user runtime home. Keep this algorithm identical to `bridge/Launcher.ts`, which
 * must stay dependency-free so it can be copied to a stable location.
 */
export function getRuntimeHome(
    env: NodeJS.ProcessEnv = process.env,
    platform: NodeJS.Platform = process.platform
): string
{
    const override = env[RuntimeHomeEnv];
    if (override)
    {
        return path.resolve(override);
    }
    if (platform === "win32")
    {
        const localAppData = env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
        return path.join(localAppData, "vscode-iteration-mcp");
    }
    const stateHome = env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
    return path.join(stateHome, "vscode-iteration-mcp");
}

export interface RuntimePaths {
    home: string;
    windowsDir: string;
    launcherPath: string;
    bridgePointerPath: string;
}

export function getRuntimePaths(home: string = getRuntimeHome()): RuntimePaths
{
    return {
        bridgePointerPath: path.join(home, "bridge.json"),
        home,
        launcherPath: path.join(home, "bin", LauncherFileName),
        windowsDir: path.join(home, "windows")
    };
}
