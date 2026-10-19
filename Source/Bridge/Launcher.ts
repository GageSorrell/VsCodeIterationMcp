/**
 * Stable launcher. The extension copies the compiled form of this file to a fixed per-user
 * path so agent configuration survives extension upgrades. It must import only Node.js
 * built-ins, and it resolves the runtime home for whichever OS user runs it.
 *
 * @module vscode-iteration-mcp/Bridge/Launcher
 *
 * @file      Launcher.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

interface BridgePointer
{
    bridgePath: string;
    extensionVersion?: string;
}

function runtimeHome(): string
{
    const override = process.env.VSCODE_ITERATION_MCP_HOME;
    if (override)
    {
        return path.resolve(override);
    }
    if (process.platform === "win32")
    {
        return path.join(
            process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
            "vscode-iteration-mcp"
        );
    }

    return path.join(
        process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"),
        "vscode-iteration-mcp"
    );
}

function fail(message: string): never
{
    process.stderr.write(`vscode-iteration-mcp-bridge: ${message}\n`);
    process.exit(1);
}

const pointerPath = path.join(runtimeHome(), "bridge.json");
let pointer: BridgePointer;
try
{
    pointer = JSON.parse(fs.readFileSync(pointerPath, "utf8")) as BridgePointer;
}
catch
{
    fail(
        `No installed bridge was found at ${pointerPath}.  ` +
        "Open a trusted workspace in VS Code with the VS Code Iteration MCP extension enabled."
    );
}
if (typeof pointer.bridgePath !== "string" || !fs.existsSync(pointer.bridgePath))
{
    fail(
        "The VS Code Iteration MCP bridge recorded in " +
        `${pointerPath} no longer exists. Open VS Code once so the extension can refresh it.`
    );
}

const bridge = require(pointer.bridgePath) as { main(argv: ReadonlyArray<string>): Promise<void> };
bridge
    .main(process.argv.slice(2))
    .catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
