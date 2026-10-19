/**
 * @module vscode-iteration-mcp/Test/Unit/Bridge.test
 *
 * @file      Bridge.test.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { type RuntimePaths, getRuntimePaths } from "../../Runtime/RuntimePaths";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpTransportHost } from "../../Mcp/Transport";
import { RuntimeRegistry } from "../../Runtime/Registry";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import assert from "node:assert/strict";
import { createTestTools } from "../../Mcp/TestTools";
import { installLauncher } from "../../Runtime/LauncherInstaller";
import { parseBridgeArguments } from "../../Bridge/Main";
import test from "node:test";

const repoRoot = path.resolve(__dirname, "..", "..", "..");

interface FakeWindow
{
    host: McpTransportHost;
    stop(): Promise<void>;
}

/** Simulates one VS Code window: a listener plus its runtime registry record. */
async function startWindow(
    registry: RuntimeRegistry,
    windowId: string,
    folders: Array<string>,
    requestedPort = 0
): Promise<FakeWindow>
{
    const host = new McpTransportHost({ tools: createTestTools(windowId) });
    const status = await host.start(requestedPort);
    assert.equal(status.state, "running", status.message);
    const connection = host.getConnection()!;
    registry.write({
        endpoint: connection.endpoint,
        extensionVersion: "test",
        pid: process.pid,
        port: connection.port,
        requestedPort,
        schema: 1,
        startedAt: new Date().toISOString(),
        token: connection.token,
        windowId,
        workspaceFolders: folders
    });
    return {
        host,
        async stop(): Promise<void>
        {
            registry.remove(windowId);
            await host.stop();
        }
    };
}

async function connectBridge(paths: RuntimePaths, args: Array<string>): Promise<Client>
{
    const client = new Client({ name: "bridge-test", version: "1.0.0" });
    await client.connect(new StdioClientTransport({
        args: [ paths.launcherPath, ...args ],
        command: process.execPath,
        env: { ...process.env, VSCODE_ITERATION_MCP_HOME: paths.home } as Record<string, string>,
        stderr: "pipe"
    }));
    return client;
}

async function echoWindow(client: Client): Promise<string>
{
    const result = await client.callTool({ arguments: { message: "ping" }, name: "test_echo" });
    assert.notEqual(result.isError, true, JSON.stringify(result));
    return (result.structuredContent as { data: { windowId: string } }).data.windowId;
}

function setup(t: { after(fn: () => unknown): void }): { paths: RuntimePaths; registry: RuntimeRegistry; root: string }
{
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vim-bridge-"));
    t.after(() => fs.rmSync(root, { force: true, recursive: true }));
    const paths = getRuntimePaths(path.join(root, "home"));
    installLauncher(paths, repoRoot, "test");
    fs.mkdirSync(path.join(root, "alpha"));
    fs.mkdirSync(path.join(root, "beta"));
    return { paths, registry: new RuntimeRegistry(paths.windowsDir), root };
}

test("bridge arguments default to the working directory and automatic port", () =>
{
    assert.deepEqual(parseBridgeArguments([], "E:\\cwd"), {
        connectTimeoutMs: 20_000,
        requestedPort: 0,
        verbose: false,
        workspace: "E:\\cwd"
    });
    assert.equal(parseBridgeArguments([ "--port", "4100", "--workspace", "E:\\w" ]).requestedPort, 4100);
    assert.throws(() => parseBridgeArguments([ "--port", "70000" ]));
    assert.throws(() => parseBridgeArguments([ "--bogus" ]));
});

test("the stable launcher is self-contained and points at the bundled bridge", (t) =>
{
    const { paths } = setup(t);
    const launcher = fs.readFileSync(paths.launcherPath, "utf8");
    assert.ok(!launcher.includes("sourceMappingURL"));
    assert.deepEqual([ ...launcher.matchAll(/require\("([^"]+)"\)/g) ].map((match) => match[1]).sort(), [ "node:fs", "node:os", "node:path" ]);
    const pointer = JSON.parse(fs.readFileSync(paths.bridgePointerPath, "utf8")) as { bridgePath: string };
    assert.equal(pointer.bridgePath, path.join(repoRoot, "dist", "bridge", "main.js"));
});

test("a stdio client reaches the owning window and reconnects after restarts without crossing workspaces", async (t) =>
{
    const { paths, registry, root } = setup(t);
    const alphaDir = path.join(root, "alpha");
    const windows: Array<FakeWindow> = [];
    t.after(async () => Promise.all(windows.map((window) => window.stop())));

    windows.push(await startWindow(registry, "alpha-1", [ alphaDir ]));
    windows.push(await startWindow(registry, "beta-1", [ path.join(root, "beta") ]));

    const client = await connectBridge(paths, [ "--workspace", alphaDir, "--connect-timeout", "5000" ]);
    t.after(() => client.close());
    assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name), [ "test_echo" ]);
    assert.equal(await echoWindow(client), "alpha-1");

    // Restart: new token and new automatic port.
    await windows[0].stop();
    windows[0] = await startWindow(registry, "alpha-2", [ alphaDir ]);
    assert.equal(await echoWindow(client), "alpha-2");

    // Reload: the window disappears briefly; the bridge waits instead of routing to beta.
    await windows[0].stop();
    const reloaded = new Promise<void>((resolve) =>
    {
        setTimeout(() =>
        {
            void startWindow(registry, "alpha-3", [ alphaDir ]).then((window) =>
            {
                windows[0] = window;
                resolve();
            });
        }, 600);
    });
    assert.equal(await echoWindow(client), "alpha-3");
    await reloaded;
});

test("a fixed requested port that the owning window does not use fails clearly", async (t) =>
{
    const { paths, registry, root } = setup(t);
    const alphaDir = path.join(root, "alpha");
    const window = await startWindow(registry, "alpha", [ alphaDir ]);
    t.after(() => window.stop());

    const unusedPort = window.host.getConnection()!.port === 1 ? 2 : 1;
    await assert.rejects(
        connectBridge(paths, [ "--workspace", alphaDir, "--port", String(unusedPort), "--connect-timeout", "300" ]),
        new RegExp(`requests port ${unusedPort}`)
    );
});

test("ambiguous discovery fails immediately and names the candidates", async (t) =>
{
    const { paths, registry, root } = setup(t);
    const alphaDir = path.join(root, "alpha");
    const first = await startWindow(registry, "alpha-a", [ alphaDir ]);
    const second = await startWindow(registry, "alpha-b", [ alphaDir ]);
    t.after(async () =>
    {
        await first.stop();
        await second.stop();
    });

    const started = Date.now();
    await assert.rejects(
        connectBridge(paths, [ "--workspace", alphaDir, "--connect-timeout", "10000" ]),
        /More than one VS Code window/
    );
    assert.ok(Date.now() - started < 5000, "ambiguity is not retried until the timeout");
});

test("no owning window fails after the connect timeout", async (t) =>
{
    const { paths, root } = setup(t);
    await assert.rejects(
        connectBridge(paths, [ "--workspace", path.join(root, "alpha"), "--connect-timeout", "300" ]),
        /No VS Code window/
    );
});
