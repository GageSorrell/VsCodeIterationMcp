/**
 * @module vscode-iteration-mcp/Test/Suite/Server.test
 *
 * @file      Server.test.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import * as vscode from "vscode";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { RuntimeRecord } from "../../Runtime/Registry";
import type { ServerStatus } from "../../Mcp/ServerController";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getRuntimePaths } from "../../Runtime/RuntimePaths";

interface SmokeStatus
{
    status: ServerStatus;
}

const paths = getRuntimePaths();

async function currentStatus(): Promise<ServerStatus>
{
    return (await vscode.commands.executeCommand<SmokeStatus>("vscodeIterationMcp.smokeTest")).status;
}

async function waitForStatus(predicate: (status: ServerStatus) => boolean, description: string): Promise<ServerStatus>
{
    const deadline = Date.now() + 15_000;
    for (;;)
    {
        const status = await currentStatus();
        if (predicate(status))
        {
            return status;
        }
        if (Date.now() > deadline)
        {
            throw new Error(`Timed out waiting for ${description}; last status ${JSON.stringify(status)}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
}

/** Reads this window's live discovery record exactly as the stdio bridge would. */
function readRecord(windowId: string): RuntimeRecord | undefined
{
    try
    {
        return JSON.parse(fs.readFileSync(path.join(paths.windowsDir, `${windowId}.json`), "utf8")) as RuntimeRecord;
    }
    catch
    {
        return undefined;
    }
}

async function freePort(): Promise<number>
{
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as net.AddressInfo).port;
    await new Promise((resolve) => server.close(resolve));
    return port;
}

async function httpClient(record: RuntimeRecord): Promise<Client>
{
    const client = new Client({ name: "integration-http", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(record.endpoint), {
        requestInit: { headers: { Authorization: `Bearer ${record.token}` } }
    }));
    return client;
}

async function echoWindow(client: Client): Promise<string>
{
    const result = await client.callTool({ arguments: { message: "ping" }, name: "test_echo" });
    assert.notEqual(result.isError, true, JSON.stringify(result));
    return (result.structuredContent as { data: { windowId: string } }).data.windowId;
}

interface DebugProfile
{
    id: string;
    kind: "configuration" | "compound";
    name: string;
    source: string;
    workspaceFolder: { path: string };
}

interface WireSuccess<T>
{
    ok: true;
    data: T;
}

interface WireFailure
{
    ok: false;
    error: { action?: string; code: string; message: string };
}

interface DebugStatusData
{
    activeSession: {
        capabilities: Record<string, boolean>;
        id: string;
        name: string;
        state: "running" | "paused" | "terminated" | "unknown";
        type: string;
    } | null;
    lastSession?: { state: "running" | "paused" | "terminated" | "unknown" };
    sessionCount: number;
    state: "running" | "paused" | "terminated" | "unknown";
}

interface TerminalSessionData
{
    active: boolean;
    id: string;
    name: string;
}

interface TerminalProfilesData
{
    complete: false;
    defaultProfile?: string;
    profiles: Array<{ isDefault: boolean; name: string }>;
}

interface TerminalReadData
{
    lineCount: number;
    name: string;
    terminalId: string;
    text: string;
}

interface SkillInstallData
{
    results: Array<{ agent: string; path?: string; status: string }>;
    scope: string;
}

interface AgentConfigData
{
    requestedPort: number;
    results: Array<{ agent: string; message?: string; path?: string; scope: string; status: string }>;
    scope: string;
    workspaceFolder?: string;
}

async function debugTool<T>(client: Client, name: string, args: Record<string, unknown> = {}): Promise<WireSuccess<T> | WireFailure>
{
    const result = await client.callTool({ arguments: args, name });
    return result.structuredContent as unknown as WireSuccess<T> | WireFailure;
}

async function terminalTool<T>(client: Client, name: string, args: Record<string, unknown> = {}): Promise<WireSuccess<T> | WireFailure>
{
    const result = await client.callTool({ arguments: args, name });
    return result.structuredContent as unknown as WireSuccess<T> | WireFailure;
}

async function waitForDebugSession(name: string): Promise<vscode.DebugSession>
{
    const deadline = Date.now() + 15_000;
    for (;;)
    {
        const session = vscode.debug.activeDebugSession?.name.includes(name)
            ? vscode.debug.activeDebugSession
            : undefined;
        if (session)
        {
            return session;
        }
        if (Date.now() > deadline)
        {
            throw new Error(`Timed out waiting for debug session '${name}'.`);
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
}

async function waitForDebugState(
    client: Client,
    expected: DebugStatusData["state"],
    description: string
): Promise<DebugStatusData>
{
    const deadline = Date.now() + 15_000;
    for (;;)
    {
        const result = await debugTool<DebugStatusData>(client, "debug_get_status");
        if (result.ok && result.data.state === expected)
        {
            return result.data;
        }
        if (Date.now() > deadline)
        {
            throw new Error(`Timed out waiting for ${description}; last result ${JSON.stringify(result)}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
}

async function stopDebugSessions(): Promise<void>
{
    await vscode.debug.stopDebugging(vscode.debug.activeDebugSession);
    const deadline = Date.now() + 15_000;
    while (vscode.debug.activeDebugSession !== undefined)
    {
        if (Date.now() > deadline)
        {
            throw new Error("Timed out waiting for the debug session to terminate.");
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
}

async function setOverride(value: number | string | undefined): Promise<ServerStatus>
{
    return value === undefined
        ? (await vscode.commands.executeCommand<ServerStatus>("vscodeIterationMcp.resetPortOverride"))
        : (await vscode.commands.executeCommand<ServerStatus>("vscodeIterationMcp.setPortOverride", value))!;
}

suite("MCP server and client connections", () =>
{
    const workspaceDir = vscode.workspace.workspaceFolders![0].uri.fsPath;
    let bridge: Client | undefined;
    let originalTerminalProfiles: unknown;
    let originalDefaultTerminalProfile: unknown;
    let terminalsBeforeTests: Set<vscode.Terminal>;

    suiteSetup(async () =>
    {
        await vscode.extensions.getExtension("gage-sorrell.vscode-iteration-mcp")!.activate();
        // Workspace state persists in the shared test user-data directory between runs.
        await setOverride(undefined);
        await vscode.workspace.getConfiguration("vscodeIterationMcp").update("port", undefined, vscode.ConfigurationTarget.Workspace);
        const terminalConfiguration = vscode.workspace.getConfiguration("terminal.integrated");
        originalTerminalProfiles = terminalConfiguration.inspect("profiles.windows")?.workspaceValue;
        originalDefaultTerminalProfile = terminalConfiguration.inspect("defaultProfile.windows")?.workspaceValue;
        terminalsBeforeTests = new Set(vscode.window.terminals);
        await terminalConfiguration.update("profiles.windows", {
            "MCP Test Profile": { path: process.env.ComSpec }
        }, vscode.ConfigurationTarget.Workspace);
        await waitForStatus((status) => status.state === "running" && status.port?.source === "default", "default port");
    });

    suiteTeardown(async () =>
    {
        await bridge?.close();
        for (const terminal of vscode.window.terminals)
        {
            if (!terminalsBeforeTests.has(terminal))
            {
                terminal.dispose();
            }
        }
        const terminalConfiguration = vscode.workspace.getConfiguration("terminal.integrated");
        await terminalConfiguration.update("profiles.windows", originalTerminalProfiles, vscode.ConfigurationTarget.Workspace);
        await terminalConfiguration.update("defaultProfile.windows", originalDefaultTerminalProfile, vscode.ConfigurationTarget.Workspace);
        await setOverride(undefined);
        await vscode.workspace.getConfiguration("vscodeIterationMcp").update("port", undefined, vscode.ConfigurationTarget.Workspace);
    });

    test("the port setting is contributed to the Settings UI as a window-scoped integer", () =>
    {
        const packageJson = vscode.extensions.getExtension("gage-sorrell.vscode-iteration-mcp")!.packageJSON as {
            contributes: { configuration: { properties: Record<string, Record<string, unknown>> } };
        };
        const port = packageJson.contributes.configuration.properties["vscodeIterationMcp.port"];
        assert.deepEqual([ port.type, port.minimum, port.maximum, port.default, port.scope ], [ "integer", 0, 65535, 0, "window" ]);
        assert.equal(vscode.workspace.getConfiguration("vscodeIterationMcp").inspect("port")?.defaultValue, 0);
    });

    test("automatic port: an HTTP client initializes, discovers tools, and calls the test handler", async () =>
    {
        const status = await currentStatus();
        assert.equal(status.requestedPort, 0);
        assert.ok(status.actualPort! > 0);
        const record = readRecord(status.windowId);
        assert.ok(record, "the window publishes runtime discovery data");
        assert.equal(record.port, status.actualPort);
        assert.equal(record.requestedPort, 0);
        assert.deepEqual(record.workspaceFolders, [ workspaceDir ]);

        const client = await httpClient(record);
        try
        {
            assert.ok((await client.listTools()).tools.some((tool) => tool.name === "test_echo"));
            assert.equal(await echoWindow(client), status.windowId);
        }
        finally
        {
            await client.close();
        }

        const unauthorized = await fetch(record.endpoint, { body: "{}", headers: { "Content-Type": "application/json" }, method: "POST" });
        assert.equal(unauthorized.status, 401);
    });

    test("a stdio client connects through the stable launcher", async () =>
    {
        assert.ok(fs.existsSync(paths.launcherPath), "the launcher is installed in the runtime home");
        bridge = new Client({ name: "integration-stdio", version: "1.0.0" });
        await bridge.connect(new StdioClientTransport({
            args: [ paths.launcherPath, "--workspace", workspaceDir ],
            command: process.execPath,
            env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } as Record<string, string>,
            stderr: "pipe"
        }));
        assert.equal(await echoWindow(bridge), (await currentStatus()).windowId);
    });

    test("lists configurations and compounds with folder-aware IDs", async () =>
    {
        const result = await debugTool<Array<DebugProfile>>(bridge!, "debug_list_profiles");
        assert.equal(result.ok, true);
        if (!result.ok)
        {
            return;
        }
        assert.deepEqual(result.data.map((profile) => profile.name), [
            "Node Fixture",
            "Node Fixture Duplicate",
            "Node Fixture Compound"
        ]);
        assert.ok(result.data.every((profile) => profile.source === "launch.json"));
        assert.ok(result.data.every((profile) => profile.workspaceFolder.path === workspaceDir));
        assert.ok(result.data.every((profile) => profile.id.includes("launch.json")));
        assert.equal(result.data.filter((profile) => profile.kind === "compound").length, 1);
    });

    test("reflects launch.json edits in subsequent profile listings", async () =>
    {
        const launchPath = path.join(workspaceDir, ".vscode", "launch.json");
        const original = fs.readFileSync(launchPath, "utf8");
        try
        {
            const edited = JSON.parse(original) as { configurations: Array<Record<string, unknown>> };
            edited.configurations.push({
                console: "internalConsole",
                name: "Node Fixture Edited",
                program: "${workspaceFolder}/launch-target.js",
                request: "launch",
                type: "node"
            });
            fs.writeFileSync(launchPath, `${JSON.stringify(edited, undefined, 4)}\n`, "utf8");

            const deadline = Date.now() + 5_000;
            for (;;)
            {
                const result = await debugTool<Array<DebugProfile>>(bridge!, "debug_list_profiles");
                if (result.ok && result.data.some((profile) => profile.name === "Node Fixture Edited"))
                {
                    break;
                }
                if (Date.now() > deadline)
                {
                    throw new Error("Edited launch.json profile did not appear in a subsequent listing.");
                }
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
        }
        finally
        {
            fs.writeFileSync(launchPath, original, "utf8");
        }
    });

    test("reports selected-profile lookup as explicit UNSUPPORTED", async () =>
    {
        const result = await debugTool<never>(bridge!, "debug_get_selected_profile");
        assert.equal(result.ok, false);
        if (result.ok)
        {
            return;
        }
        assert.equal(result.error.code, "UNSUPPORTED");
        assert.match(result.error.message, /selected launch-profile lookup is UNSUPPORTED/i);
        assert.match(result.error.action ?? "", /debug_list_profiles/);
    });

    test("starts a specified saved Node profile and preserves its workspace scope", async () =>
    {
        const listed = await debugTool<Array<DebugProfile>>(bridge!, "debug_list_profiles");
        assert.equal(listed.ok, true);
        if (!listed.ok)
        {
            return;
        }
        const profile = listed.data.find((candidate) => candidate.name === "Node Fixture");
        assert.ok(profile);
        const started = await debugTool<{ started: true; profileId: string; workspaceFolder: { path: string } }>(
            bridge!,
            "debug_start",
            { profileId: profile.id }
        );
        assert.equal(started.ok, true);
        if (!started.ok)
        {
            return;
        }
        assert.equal(started.data.started, true);
        assert.equal(started.data.profileId, profile.id);
        assert.equal(started.data.workspaceFolder.path, workspaceDir);
        const session = await waitForDebugSession("Node Fixture");
        assert.equal(session.workspaceFolder?.uri.fsPath, workspaceDir);
        await vscode.debug.stopDebugging(session);
        await stopDebugSessions();
    });

    test("omitted profileId invokes VS Code Start Debugging for the current selection", async () =>
    {
        const started = await debugTool<{ started: true }>(bridge!, "debug_start");
        assert.equal(started.ok, true);
        if (!started.ok)
        {
            return;
        }
        assert.equal(started.data.started, true);
        await waitForDebugSession("Node Fixture");
        await stopDebugSessions();
    });

    test("reports state and controls pause, stepping, continue, restart, and stop", async () =>
    {
        const started = await debugTool<{ started: true }>(bridge!, "debug_start");
        assert.equal(started.ok, true);
        await waitForDebugSession("Node Fixture");

        const paused = await waitForDebugState(bridge!, "paused", "the debug session to pause at debugger");
        assert.ok(paused.activeSession);
        assert.equal(paused.activeSession?.name.includes("Node Fixture"), true);

        const stepped = await debugTool<DebugStatusData>(bridge!, "debug_control", { action: "step_over" });
        assert.equal(stepped.ok, true, JSON.stringify(stepped));
        await waitForDebugState(bridge!, "paused", "the step-over operation to pause again");

        const continued = await debugTool<DebugStatusData>(bridge!, "debug_control", { action: "continue" });
        assert.equal(continued.ok, true, JSON.stringify(continued));
        await waitForDebugState(bridge!, "running", "the debug session to continue");

        const pause = await debugTool<never>(bridge!, "debug_control", { action: "pause" });
        assert.equal(pause.ok, false);
        if (!pause.ok)
        {
            assert.equal(pause.error.code, "NOT_SUPPORTED");
            assert.match(pause.error.message, /supportsPauseRequest|pause/);
        }

        const restarted = await debugTool<DebugStatusData>(bridge!, "debug_control", { action: "restart" });
        assert.equal(restarted.ok, true, JSON.stringify(restarted));
        await waitForDebugState(bridge!, "paused", "the restarted debug session to pause at debugger");

        const stopped = await debugTool<DebugStatusData>(bridge!, "debug_control", { action: "stop" });
        assert.equal(stopped.ok, true, JSON.stringify(stopped));
        const terminated = await waitForDebugState(bridge!, "terminated", "the debug session to terminate");
        assert.equal(terminated.activeSession, null);
        assert.equal(terminated.lastSession?.state, "terminated");

        const noSession = await debugTool<never>(bridge!, "debug_control", { action: "continue" });
        assert.equal(noSession.ok, false);
        if (!noSession.ok)
        {
            assert.equal(noSession.error.code, "NOT_READY");
        }
    });

    test("reports unsupported reverse debugging without substituting another action", async () =>
    {
        const started = await debugTool<{ started: true }>(bridge!, "debug_start");
        assert.equal(started.ok, true);
        await waitForDebugSession("Node Fixture");
        await waitForDebugState(bridge!, "running", "the debug session to run");
        await debugTool(bridge!, "debug_control", { action: "pause" });
        await waitForDebugState(bridge!, "paused", "the debug session to pause");

        const reverse = await debugTool<never>(bridge!, "debug_control", { action: "reverse_continue" });
        assert.equal(reverse.ok, false);
        if (!reverse.ok)
        {
            assert.equal(reverse.error.code, "NOT_SUPPORTED");
            assert.match(reverse.error.message, /supportsReverseContinue|reverse_continue/);
        }
        await vscode.debug.stopDebugging(vscode.debug.activeDebugSession);
        await stopDebugSessions();
    });

    test("creates, switches, and sends input to default and configured terminals", async () =>
    {
        const profiles = await terminalTool<TerminalProfilesData>(bridge!, "terminal_list_profiles");
        assert.equal(profiles.ok, true, JSON.stringify(profiles));
        if (!profiles.ok)
        {
            return;
        }
        assert.equal(profiles.data.complete, false);
        assert.ok(profiles.data.profiles.some((profile) => profile.name === "MCP Test Profile"));

        const before = await terminalTool<Array<TerminalSessionData>>(bridge!, "terminal_list");
        assert.equal(before.ok, true, JSON.stringify(before));
        const defaultTerminal = await terminalTool<TerminalSessionData & { created: true }>(
            bridge!,
            "terminal_create"
        );
        assert.equal(defaultTerminal.ok, true, JSON.stringify(defaultTerminal));
        if (!defaultTerminal.ok)
        {
            return;
        }
        assert.equal(defaultTerminal.data.created, true);
        assert.equal(defaultTerminal.data.active, true);

        const namedTerminal = await terminalTool<TerminalSessionData & { created: true; profileName: string }>(
            bridge!,
            "terminal_create",
            { profileName: "MCP Test Profile" }
        );
        assert.equal(namedTerminal.ok, true, JSON.stringify(namedTerminal));
        if (!namedTerminal.ok)
        {
            return;
        }
        assert.equal(namedTerminal.data.profileName, "MCP Test Profile");
        assert.equal(namedTerminal.data.active, true);
        assert.notEqual(namedTerminal.data.id, defaultTerminal.data.id);

        const focused = await terminalTool<TerminalSessionData>(bridge!, "terminal_focus", {
            terminalId: defaultTerminal.data.id
        });
        assert.equal(focused.ok, true, JSON.stringify(focused));
        if (!focused.ok)
        {
            return;
        }
        assert.equal(focused.data.id, defaultTerminal.data.id);
        assert.equal(focused.data.active, true);

        const noEnter = await terminalTool<{ pressEnter: boolean; terminalId: string }>(
            bridge!,
            "terminal_send_text",
            { text: "echo mcp-terminal", pressEnter: false }
        );
        assert.equal(noEnter.ok, true, JSON.stringify(noEnter));
        if (!noEnter.ok)
        {
            return;
        }
        assert.equal(noEnter.data.pressEnter, false);
        assert.equal(noEnter.data.terminalId, defaultTerminal.data.id);

        const enterOnly = await terminalTool<{ pressEnter: boolean; textLength: number }>(
            bridge!,
            "terminal_send_text",
            { pressEnter: true, text: "" }
        );
        assert.equal(enterOnly.ok, true, JSON.stringify(enterOnly));
        if (!enterOnly.ok)
        {
            return;
        }
        assert.equal(enterOnly.data.pressEnter, true);
        assert.equal(enterOnly.data.textLength, 0);

        await terminalTool(bridge!, "terminal_send_text", {
            pressEnter: true,
            text: "echo mcp-read-line-1"
        });
        await terminalTool(bridge!, "terminal_send_text", {
            pressEnter: true,
            text: "echo mcp-read-line-2"
        });
        await vscode.env.clipboard.writeText("mcp-original-clipboard");
        let read: WireSuccess<TerminalReadData> | WireFailure = { ok: false, error: { code: "NOT_READY", message: "not attempted" } };
        const readDeadline = Date.now() + 5_000;
        while (!(read.ok && read.data.text.includes("mcp-read-line-2")))
        {
            read = await terminalTool<TerminalReadData>(bridge!, "terminal_read");
            if (Date.now() > readDeadline)
            {
                throw new Error(`Timed out waiting for terminal output: ${JSON.stringify(read)}`);
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        assert.equal(read.ok, true);
        if (!read.ok)
        {
            return;
        }
        assert.equal(read.data.terminalId, defaultTerminal.data.id);
        assert.ok(read.data.lineCount > 0);
        assert.equal(await vscode.env.clipboard.readText(), "mcp-original-clipboard");

        const limited = await terminalTool<TerminalReadData>(bridge!, "terminal_read", { maxLines: 1 });
        assert.equal(limited.ok, true, JSON.stringify(limited));
        if (!limited.ok)
        {
            return;
        }
        assert.equal(limited.data.lineCount, 1);

        const invalidLimit = await terminalTool<never>(bridge!, "terminal_read", { maxLines: 0 });
        assert.equal(invalidLimit.ok, false);
        if (!invalidLimit.ok)
        {
            assert.equal(invalidLimit.error.code, "INVALID_ARGUMENT");
        }

        const namedAgain = await terminalTool<TerminalSessionData & { created: true }>(
            bridge!,
            "terminal_create",
            { profileName: "MCP Test Profile" }
        );
        assert.equal(namedAgain.ok, true, JSON.stringify(namedAgain));
        if (!namedAgain.ok)
        {
            return;
        }
        assert.notEqual(namedAgain.data.id, namedTerminal.data.id, "duplicate terminal names use distinct IDs");

        const missing = await terminalTool<never>(bridge!, "terminal_focus", { terminalId: "missing-terminal" });
        assert.equal(missing.ok, false);
        if (!missing.ok)
        {
            assert.equal(missing.error.code, "NOT_FOUND");
        }
    });

    test("installs the bundled skill for both agents and is idempotent", async () =>
    {
        const skillHome = process.env.VSCODE_ITERATION_MCP_SKILL_HOME;
        assert.ok(skillHome);
        const first = await vscode.commands.executeCommand<SkillInstallData>(
            "vscodeIterationMcp.installSkill",
            "user"
        );
        assert.equal(first.scope, "user");
        assert.deepEqual(first.results.map((result) => [ result.agent, result.status ]), [
            [ "claude-code", "installed" ],
            [ "codex", "installed" ]
        ]);

        const extensionPath = vscode.extensions.getExtension("gage-sorrell.vscode-iteration-mcp")!.extensionPath;
        const bundled = fs.readFileSync(path.join(extensionPath, "resources", "skills", "vscode-iteration-mcp", "SKILL.md"), "utf8");
        const claudePath = path.join(skillHome, ".claude", "skills", "vscode-iteration-mcp", "SKILL.md");
        const codexPath = path.join(skillHome, ".agents", "skills", "vscode-iteration-mcp", "SKILL.md");
        assert.equal(fs.readFileSync(claudePath, "utf8"), bundled);
        assert.equal(fs.readFileSync(codexPath, "utf8"), bundled);
        const before = [ fs.statSync(claudePath).mtimeMs, fs.statSync(codexPath).mtimeMs ];

        const second = await vscode.commands.executeCommand<SkillInstallData>(
            "vscodeIterationMcp.installSkill",
            "user"
        );
        assert.deepEqual(second.results.map((result) => result.status), [ "unchanged", "unchanged" ]);
        assert.deepEqual([ fs.statSync(claudePath).mtimeMs, fs.statSync(codexPath).mtimeMs ], before);
    });

    test("merges durable agent configuration, preserves unrelated content, and fixes project mismatches", async () =>
    {
        const skillHome = process.env.VSCODE_ITERATION_MCP_SKILL_HOME;
        const codexHome = process.env.VSCODE_ITERATION_MCP_CODEX_HOME;
        assert.ok(skillHome);
        assert.ok(codexHome);
        const claudePath = path.join(skillHome, ".claude.json");
        const codexPath = path.join(codexHome, "config.toml");
        fs.mkdirSync(path.dirname(claudePath), { recursive: true });
        fs.mkdirSync(path.dirname(codexPath), { recursive: true });
        fs.writeFileSync(claudePath, `${JSON.stringify({ unrelated: true, mcpServers: { other: { command: "other" } } }, undefined, 2)}\n`, "utf8");
        fs.writeFileSync(codexPath, "# keep this comment\n[other]\nvalue = \"keep\"\n", "utf8");

        const first = await vscode.commands.executeCommand<AgentConfigData>(
            "vscodeIterationMcp.addToAgents",
            { agents: [ "claude-code", "codex" ], scope: "user" }
        );
        assert.equal(first.scope, "user");
        assert.deepEqual(first.results.map((result) => [ result.agent, result.status ]), [
            [ "claude-code", "updated" ],
            [ "codex", "updated" ]
        ]);
        const claude = JSON.parse(fs.readFileSync(claudePath, "utf8")) as {
            mcpServers: Record<string, { args: Array<string>; command: string; type: string }>;
            unrelated: boolean;
        };
        assert.equal(claude.unrelated, true);
        assert.equal(claude.mcpServers.other.command, "other");
        assert.deepEqual(claude.mcpServers["vscode-iteration-mcp"].args, [ paths.launcherPath, "--port", "0" ]);
        const codex = fs.readFileSync(codexPath, "utf8");
        assert.match(codex, /# keep this comment/);
        assert.match(codex, /value = "keep"/);
        assert.match(codex, /\[mcp_servers\.vscode-iteration-mcp\]/);
        assert.match(codex, /command = "node"/);
        assert.match(codex, /args = \[".*vscode-iteration-mcp-bridge\.js","--port","0"\]/);

        const second = await vscode.commands.executeCommand<AgentConfigData>(
            "vscodeIterationMcp.addToAgents",
            { agents: [ "claude-code", "codex" ], scope: "user" }
        );
        assert.deepEqual(second.results.map((result) => result.status), [ "unchanged", "unchanged" ]);

        const workspacePort = await freePort();
        await vscode.workspace.getConfiguration("vscodeIterationMcp").update("port", workspacePort, vscode.ConfigurationTarget.Workspace);
        await waitForStatus(
            (status) => status.port?.source === "workspace" && status.requestedPort === workspacePort,
            "workspace port before project mismatch repair"
        );
        const project = await vscode.commands.executeCommand<AgentConfigData>(
            "vscodeIterationMcp.addProjectWorkspaceSettings",
            { agents: [ "claude-code" ] }
        );
        assert.equal(project.scope, "project");
        assert.equal(project.workspaceFolder, workspaceDir);
        assert.deepEqual(project.results.map((result) => [ result.agent, result.status ]), [ [ "claude-code", "installed" ] ]);
        const projectClaude = JSON.parse(fs.readFileSync(path.join(workspaceDir, ".mcp.json"), "utf8")) as {
            mcpServers: Record<string, { args: Array<string> }>;
        };
        assert.deepEqual(projectClaude.mcpServers["vscode-iteration-mcp"].args, [
            paths.launcherPath,
            "--workspace",
            workspaceDir,
            "--port",
            String(workspacePort)
        ]);
        await vscode.workspace.getConfiguration("vscodeIterationMcp").update("port", undefined, vscode.ConfigurationTarget.Workspace);
        await waitForStatus((status) => status.port?.source === "default", "default port after project mismatch repair");
    });

    test("missing profile IDs return an actionable stale-profile error", async () =>
    {
        const result = await debugTool<never>(bridge!, "debug_start", { profileId: "stale-profile-id" });
        assert.equal(result.ok, false);
        if (result.ok)
        {
            return;
        }
        assert.equal(result.error.code, "INVALID_ARGUMENT");
        assert.match(result.error.action ?? "", /debug_list_profiles/);
    });

    test("override takes precedence, restarts the listener, and is followed by the bridge", async () =>
    {
        const before = await currentStatus();
        const oldRecord = readRecord(before.windowId)!;
        const port = await freePort();

        const status = await setOverride(port);
        assert.equal(status.state, "running");
        assert.equal(status.port?.source, "override");
        assert.equal(status.port?.overridePort, port);
        assert.equal(status.requestedPort, port);
        assert.equal(status.actualPort, port);
        assert.equal(readRecord(status.windowId)?.port, port);

        await assert.rejects(fetch(oldRecord.endpoint, { method: "POST" }), "the old listener is closed");
        assert.equal(await echoWindow(bridge!), status.windowId, "the bridge rediscovers the new endpoint");

        const reset = await setOverride(undefined);
        assert.equal(reset.port?.source, "default");
        assert.equal(reset.requestedPort, 0);
        assert.notEqual(reset.actualPort, undefined);
    });

    test("workspace setting applies when there is no override; an override of 0 still wins", async () =>
    {
        const port = await freePort();
        await vscode.workspace.getConfiguration("vscodeIterationMcp").update("port", port, vscode.ConfigurationTarget.Workspace);
        let status = await waitForStatus((s) => s.actualPort === port, "workspace setting port");
        assert.equal(status.port?.source, "workspace");
        assert.equal(status.port?.settingPort, port);

        status = await setOverride(0);
        assert.equal(status.port?.source, "override");
        assert.equal(status.requestedPort, 0);
        assert.equal(status.port?.settingPort, port, "the Settings value is reported separately from the override");

        status = await setOverride(undefined);
        assert.equal(status.actualPort, port);

        await vscode.workspace.getConfiguration("vscodeIterationMcp").update("port", undefined, vscode.ConfigurationTarget.Workspace);
        await waitForStatus((s) => s.port?.source === "default" && s.requestedPort === 0, "default after clearing setting");
    });

    test("invalid override input leaves the running listener unchanged", async () =>
    {
        const before = await currentStatus();
        for (const value of [ 70000, "-1", "abc" ])
        {
            const after = await setOverride(value);
            assert.equal(after.state, "running");
            assert.equal(after.actualPort, before.actualPort);
            assert.equal(after.port?.source, before.port?.source);
        }
    });

    test("an occupied fixed port is reported without falling back, and reset recovers", async () =>
    {
        const blocker = net.createServer();
        await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
        const occupied = (blocker.address() as net.AddressInfo).port;
        try
        {
            const status = await setOverride(occupied);
            assert.equal(status.state, "error");
            assert.equal(status.requestedPort, occupied);
            assert.equal(status.actualPort, undefined);
            assert.match(status.message ?? "", /already in use/);
            assert.equal(readRecord(status.windowId), undefined, "a failed listener is not advertised");
        }
        finally
        {
            await new Promise((resolve) => blocker.close(resolve));
        }
        const recovered = await setOverride(undefined);
        assert.equal(recovered.state, "running");
    });

    test("stop releases the listener and discovery data; start advertises a new endpoint", async () =>
    {
        const running = await currentStatus();
        const record = readRecord(running.windowId)!;

        const stopped = await vscode.commands.executeCommand<ServerStatus>("vscodeIterationMcp.stopServer");
        assert.equal(stopped.state, "stopped");
        assert.equal(readRecord(running.windowId), undefined);
        await assert.rejects(fetch(record.endpoint, { method: "POST" }));

        // A configuration change while stopped does not restart the server.
        await setOverride(0);
        assert.equal((await currentStatus()).state, "stopped");

        const started = await vscode.commands.executeCommand<ServerStatus>("vscodeIterationMcp.startServer");
        assert.equal(started.state, "running");
        const newRecord = readRecord(started.windowId)!;
        assert.equal(newRecord.port, started.actualPort);
        assert.equal(newRecord.token, record.token, "the per-window token is stable for the window's lifetime");
        assert.equal(await echoWindow(bridge!), started.windowId);
        await setOverride(undefined);
    });

    test("copied stdio configuration uses the stable launcher and contains no credentials", async () =>
    {
        await vscode.commands.executeCommand("vscodeIterationMcp.copyStdioConfig");
        const text = await vscode.env.clipboard.readText();
        const config = JSON.parse(text) as { mcpServers: Record<string, { args: Array<string>; command: string; type: string }> };
        const entry = config.mcpServers["vscode-iteration-mcp"];
        assert.equal(entry.type, "stdio");
        assert.deepEqual(entry.args, [ paths.launcherPath, "--workspace", workspaceDir, "--port", "0" ]);
        const record = readRecord((await currentStatus()).windowId)!;
        assert.ok(!text.includes(record.token));
    });
});
