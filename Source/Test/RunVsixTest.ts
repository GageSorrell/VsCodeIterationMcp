/**
 * @module vscode-iteration-mcp/Test/RunVsixTest
 *
 * @file      RunVsixTest.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { runTests } from "@vscode/test-electron";

function powershellLiteral(value: string): string
{
    return `'${value.replace(/'/g, "''")}'`;
}

async function main(): Promise<void>
{
    // The Codex/VS Code-hosted shell may inherit this flag; the test binary must run as Electron.
    delete process.env.ELECTRON_RUN_AS_NODE;
    const repositoryRoot = path.resolve(__dirname, "..", "..");
    const vsixPath = path.join(repositoryRoot, "dist", "vscode-iteration-mcp.vsix");
    if (!fs.existsSync(vsixPath))
    {
        throw new Error(`VSIX not found at ${vsixPath}; run npm run package first.`);
    }

    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "vscode-iteration-mcp-vsix-it-"));
    const extracted = path.join(scratch, "package");
    const workspacePath = path.join(scratch, "trusted-workspace");
    fs.mkdirSync(extracted, { recursive: true });
    fs.cpSync(path.join(repositoryRoot, "test-fixtures", "trusted-workspace"), workspacePath, { recursive: true });
    execFileSync(
        "powershell.exe",
        [
            "-NoLogo",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            `Expand-Archive -LiteralPath ${powershellLiteral(vsixPath)} -DestinationPath ${powershellLiteral(extracted)} -Force`
        ],
        { stdio: "inherit" }
    );

    try
    {
        const exitCode = await runTests({
            version: process.env.VSCODE_TEST_VERSION ?? "1.142.0",
            extensionDevelopmentPath: path.join(extracted, "extension"),
            extensionTestsPath: path.join(repositoryRoot, "dist", "test", "suite", "index.js"),
            launchArgs: [ `--folder-uri=${pathToFileURL(workspacePath).toString()}` ],
            extensionTestsEnv: {
                VSCODE_ITERATION_MCP_TEST: "1",
                VSCODE_ITERATION_MCP_HOME: path.join(scratch, "runtime-home"),
                VSCODE_ITERATION_MCP_SKILL_HOME: path.join(scratch, "skill-home"),
                VSCODE_ITERATION_MCP_CODEX_HOME: path.join(scratch, "codex-home")
            }
        });
        if (exitCode !== 0)
        {
            throw new Error(`Packaged VSIX integration tests exited with code ${exitCode}.`);
        }
    }
    finally
    {
        fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5 });
    }
}

void main().catch((error: unknown) =>
{
    console.error(error);
    process.exit(1);
});
