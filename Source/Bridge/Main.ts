/**
 * @module vscode-iteration-mcp/Bridge/Main
 *
 * @file      Main.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

import { RuntimeRegistry } from "../Runtime/Registry";
import { StdioBridge } from "./Bridge";
import { getRuntimePaths } from "../Runtime/RuntimePaths";
import { isValidPort } from "../Settings/PortResolution";

export const DefaultConnectTimeoutMs = 20_000;

export interface BridgeArguments
{
    workspace: string;
    requestedPort: number;
    connectTimeoutMs: number;
    verbose: boolean;
}

const Usage: string = "Usage: vscode-iteration-mcp-bridge [--workspace <path>] [--port <0-65535>] " +
    "[--connect-timeout <ms>] [--verbose]\n\n" +
    "Relays MCP over stdio to the VS Code window that owns <path> (default: the current directory).\n" +
    "--port 0 (default) accepts whichever port that window was assigned.";

export function parseBridgeArguments(
    argv: ReadonlyArray<string>,
    cwd: string = process.cwd()
): BridgeArguments
{
    const result: BridgeArguments =
        {
            connectTimeoutMs: DefaultConnectTimeoutMs,
            requestedPort: 0,
            verbose: false,
            workspace: cwd
        };

    for (let index = 0; index < argv.length; index++)
    {
        const flag = argv[index];
        const value = (): string =>
        {
            const next = argv[++index];
            if (next === undefined)
            {
                throw new Error(`${flag} requires a value.`);
            }
            return next;
        };
        switch (flag)
        {
            case "--workspace":
                result.workspace = value();
                break;
            case "--port": {
                const port = Number(value());
                if (!isValidPort(port))
                {
                    throw new Error("--port must be an integer from 0 through 65535.");
                }
                result.requestedPort = port;
                break;
            }
            case "--connect-timeout": {
                const timeout = Number(value());
                if (!Number.isInteger(timeout) || timeout < 0)
                {
                    throw new Error(
                        "--connect-timeout must be a non-negative integer number of milliseconds."
                    );
                }
                result.connectTimeoutMs = timeout;
                break;
            }
            case "--verbose":
                result.verbose = true;
                break;
            default:
                throw new Error(`Unknown argument '${flag}'.`);
        }
    }
    return result;
}

export async function main(argv: ReadonlyArray<string>): Promise<void>
{
    if (argv.includes("--help") || argv.includes("-h"))
    {
        process.stderr.write(`${Usage}\n`);
        return;
    }
    let args: BridgeArguments;
    try
    {
        args = parseBridgeArguments(argv);
    }
    catch (error: unknown)
    {
        process.stderr.write(
            `vscode-iteration-mcp-bridge: ${error instanceof Error ? error.message : String(error)}` +
            `\n${Usage}\n`
        );
        process.exitCode = 2;
        return;
    }

    const bridge = new StdioBridge({
        connectTimeoutMs: args.connectTimeoutMs,
        log: args.verbose
            ? (message: string) => process.stderr.write(`vscode-iteration-mcp-bridge: ${message}\n`)
            : undefined,
        registry: new RuntimeRegistry(getRuntimePaths().windowsDir),
        requestedPort: args.requestedPort,
        workspace: args.workspace
    });
    const shutdown = (): void =>
    {
        void bridge.close().finally(() => process.exit(0));
    };
    process.stdin.once("end", shutdown);
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    await bridge.start();
}

if (require.main === module)
{
    void main(process.argv.slice(2));
}
