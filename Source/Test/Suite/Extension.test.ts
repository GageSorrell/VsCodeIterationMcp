/**
 * @module vscode-iteration-mcp/Test/Suite/Extension.test
 *
 * @file      Extension.test.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

import * as assert from "node:assert/strict";
import * as vscode from "vscode";

suite("VS Code Iteration MCP extension", () =>
{
    test("loads with the intended display name and starts in the trusted test workspace", async () =>
    {
        assert.equal(vscode.workspace.isTrusted, true);
        const extension = vscode.extensions.getExtension("gage-sorrell.vscode-iteration-mcp");
        assert.ok(extension, "extension must be present in the development host");
        await extension.activate();

        const status = await vscode.commands.executeCommand<{
            displayName: string;
            trustedWorkspace: boolean;
            serverStarted: boolean;
            transportState: string;
        }>("vscodeIterationMcp.smokeTest");

        assert.equal(status.displayName, "VS Code Iteration MCP");
        assert.equal(status.trustedWorkspace, true);
        assert.equal(status.serverStarted, true);
        assert.equal(status.transportState, "running");

        const manifest = extension.packageJSON as {
            contributes?: {
                viewsContainers?: { activitybar?: Array<{ id: string; icon: string }> };
                views?: Record<string, Array<{ id: string; type: string }>>;
            };
        };
        const container = manifest.contributes?.viewsContainers?.activitybar?.find((entry) => entry.id === "vscodeIterationMcp");
        assert.ok(container);
        assert.equal(container.icon, "resources/sidebar-icon.svg");
        assert.deepEqual(manifest.contributes?.views?.vscodeIterationMcp, [
            { id: "vscodeIterationMcp.sidebar", name: "Setup", type: "webview", visibility: "visible" }
        ]);
    });
});
