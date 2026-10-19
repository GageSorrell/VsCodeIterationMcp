/**
 * @module vscode-iteration-mcp/Test/RunCleanProfileTest
 *
 * @file      RunCleanProfileTest.ts
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
    delete process.env.ELECTRON_RUN_AS_NODE;
    const repositoryRoot = path.resolve(__dirname, "..", "..");
    const vsixPath = path.join(repositoryRoot, "dist", "vscode-iteration-mcp.vsix");
    if (!fs.existsSync(vsixPath))
    {
        throw new Error(`VSIX not found at ${vsixPath}; run npm run package first.`);
    }

    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "vscode-iteration-mcp-clean-profile-"));
    const userDataDir = path.join(scratch, "user-data");
    const extensionsDir = path.join(scratch, "extensions");
    const workspacePath = path.join(scratch, "trusted-workspace");
    fs.cpSync(path.join(repositoryRoot, "test-fixtures", "trusted-workspace"), workspacePath, { recursive: true });
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.mkdirSync(extensionsDir, { recursive: true });

    const codeCommand = process.env.VSCODE_BIN ?? "code.cmd";
    execFileSync(codeCommand, [
        "--user-data-dir", userDataDir,
        "--extensions-dir", extensionsDir,
        "--install-extension", vsixPath,
        "--force"
    ], { stdio: "inherit", shell: process.platform === "win32" && /\.cmd$/i.test(codeCommand) });

    const installedDirectory = fs.readdirSync(extensionsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.startsWith("gage-sorrell.vscode-iteration-mcp-"))
        .map((entry) => path.join(extensionsDir, entry.name))[0];
    if (installedDirectory === undefined)
    {
        throw new Error(`VSIX was not installed into ${extensionsDir}.`);
    }

    try
    {
        const exitCode = await runTests({
            version: process.env.VSCODE_TEST_VERSION ?? "1.142.0",
            extensionDevelopmentPath: installedDirectory,
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
            throw new Error(`Clean-profile VSIX integration tests exited with code ${exitCode}.`);
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
