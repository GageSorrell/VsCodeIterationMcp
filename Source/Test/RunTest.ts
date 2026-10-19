/**
 * @module vscode-iteration-mcp/Test/RunTest
 *
 * @file      RunTest.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { runTests } from "@vscode/test-electron";

async function main(): Promise<void>
{
    // Codex/VS Code-hosted shells can inherit this flag; the test binary must run as Electron.
    delete process.env.ELECTRON_RUN_AS_NODE;
    const extensionDevelopmentPath = path.resolve(__dirname, "..", "..");
    const extensionTestsPath = path.resolve(__dirname, "suite", "index.js");
    // Tests write workspace settings and runtime discovery files, so use disposable copies.
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "vscode-iteration-mcp-it-"));
    const workspacePath = path.join(scratch, "trusted-workspace");
    fs.cpSync(path.resolve(__dirname, "..", "..", "test-fixtures", "trusted-workspace"), workspacePath, { recursive: true });
    const launchArgs = [ `--folder-uri=${pathToFileURL(workspacePath).toString()}` ];

    await runTests({
        version: process.env.VSCODE_TEST_VERSION ?? "1.142.0",
        extensionDevelopmentPath,
        extensionTestsPath,
        launchArgs,
        extensionTestsEnv: {
            VSCODE_ITERATION_MCP_TEST: "1",
            VSCODE_ITERATION_MCP_HOME: path.join(scratch, "runtime-home"),
            VSCODE_ITERATION_MCP_SKILL_HOME: path.join(scratch, "skill-home"),
            VSCODE_ITERATION_MCP_CODEX_HOME: path.join(scratch, "codex-home")
        }
    }).finally(() => fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5 }));
}

void main().catch((error: unknown) =>
{
    console.error(error);
    process.exit(1);
});
