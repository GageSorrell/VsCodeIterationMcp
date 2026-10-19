/**
 * @module vscode-iteration-mcp/Mcp/ServerController
 *
 * @file      ServerController.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

import * as vscode from "vscode";
import { McpTransportHost, type TransportConnection, type TransportState } from "./Transport";
import { PortOverrideStore, type PortResolution, resolveRequestedPort } from "../Settings/PortResolution";
import { type RuntimePaths, getRuntimePaths } from "../Runtime/RuntimePaths";
import { type RuntimeRecord, RuntimeRegistry } from "../Runtime/Registry";
import { createTestTools, isTestMode } from "./TestTools";
import { McpDefinitionProvider } from "./DefinitionProvider";
import { Result } from "effect";
import type { StructuredResult } from "../Core/Results";
import { installLauncher } from "../Runtime/LauncherInstaller";
import { randomUUID } from "node:crypto";
import { readPortSetting } from "../Settings/Settings";
import { DebuggerService } from "../Debugger/DebuggerService";
import { createDebuggerTools } from "../Debugger/DebuggerTools";
import { TerminalService } from "../Terminal/TerminalService";
import { createTerminalTools } from "../Terminal/TerminalTools";

/** Connection status shown to users. It never contains the bearer token. */
export interface ServerStatus
{
    actualPort?: number;
    /** Invalid setting or override that was not applied; the listener is left unchanged. */
    configurationError?: string;
    endpoint?: string;
    /** Listener error, or why the server is not running. */
    message?: string;
    /** Effective requested port from override, Settings, or default. */
    port?: PortResolution;
    /** Requested port of the current (or last attempted) listener. */
    requestedPort?: number;
    state: TransportState;
    windowId: string;
}

/**
 * Coordinates this window's listener with port precedence, the per-user runtime registry, and
 * VS Code's MCP definition provider.
 */
export class ServerController implements vscode.Disposable
{
    readonly windowId: string = randomUUID();

    readonly definitions: McpDefinitionProvider;

    private readonly host: McpTransportHost;

    private readonly debugger: DebuggerService;

    private readonly terminal: TerminalService;

    private readonly overrides: PortOverrideStore;

    private readonly paths: RuntimePaths = getRuntimePaths();

    private readonly registry: RuntimeRegistry;

    private readonly statusChanged: vscode.EventEmitter<ServerStatus> =
        new vscode.EventEmitter<ServerStatus>();

    private resolution: StructuredResult<PortResolution>;

    private configurationError: string | undefined;

    private notRunningReason: string | undefined;

    /** Whether the server should be listening; a user Stop clears it until Start. */
    private wantRunning: boolean = false;

    readonly onDidChangeStatus: vscode.Event<ServerStatus> = this.statusChanged.event;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly log: vscode.LogOutputChannel
    )
    {
        this.debugger = new DebuggerService();
        this.terminal = new TerminalService();
        this.overrides = new PortOverrideStore(context.workspaceState);
        this.registry = new RuntimeRegistry(this.paths.windowsDir);
        this.host = new McpTransportHost({
            log: (message: string) => this.log.warn(message),
            tools: [
                ...createDebuggerTools(this.debugger),
                ...createTerminalTools(this.terminal),
                ...(isTestMode() ? createTestTools(this.windowId) : [])
            ]
        });
        this.definitions = new McpDefinitionProvider(() => this.host.getConnection(), this.extensionVersion);
        this.resolution = this.resolvePort();
    }

    get launcherPath(): string
    {
        return this.paths.launcherPath;
    }

    private get extensionVersion(): string
    {
        return String((this.context.extension.packageJSON as { version?: string }).version ?? "0.0.0");
    }

    getStatus(): ServerStatus
    {
        const transport = this.host.getStatus();
        const port = Result.isSuccess(this.resolution) ? this.resolution.success : undefined;
        const status: ServerStatus = {
            actualPort: transport.actualPort,
            configurationError: this.configurationError,
            endpoint: transport.endpoint,
            message: transport.message ?? (transport.state === "stopped" ? this.notRunningReason : undefined),
            port,
            requestedPort: transport.state === "stopped" ? undefined : transport.requestedPort,
            state: transport.state,
            windowId: this.windowId
        };
        return status;
    }

    getConnection(): TransportConnection | undefined
    {
        return this.host.getConnection();
    }

    /** Starts (or restarts) on the effective requested port. */
    async start(): Promise<ServerStatus>
    {
        if (!vscode.workspace.isTrusted)
        {
            this.notRunningReason = "The workspace is not trusted. Trust the workspace to start the server.";
            return this.publish();
        }
        if (vscode.env.remoteName !== undefined)
        {
            this.notRunningReason = `Remote environments ('${vscode.env.remoteName}') are not supported.`;
            return this.publish();
        }
        this.resolution = this.resolvePort();
        if (Result.isFailure(this.resolution))
        {
            this.configurationError = describe(this.resolution.failure);
            this.notRunningReason = this.configurationError;
            this.log.error(this.configurationError);
            return this.publish();
        }
        this.configurationError = undefined;
        this.notRunningReason = undefined;
        this.wantRunning = true;

        const requestedPort = this.resolution.success.requestedPort;
        this.log.info(`Starting on 127.0.0.1 with requested port ${requestedPort}.`);
        const status = await this.host.start(requestedPort);
        if (status.state === "running")
        {
            this.log.info(`Listening at ${status.endpoint}.`);
            this.writeRuntimeRecord();
            this.installLauncher();
        }
        else
        {
            this.registry.remove(this.windowId);
            this.log.error(status.message ?? "The server failed to start.");
        }
        return this.publish();
    }

    async stop(reason: string = "Stopped by user."): Promise<ServerStatus>
    {
        this.wantRunning = false;
        this.notRunningReason = reason;
        this.registry.remove(this.windowId);
        await this.host.stop();
        this.log.info(`Server stopped: ${reason}`);
        return this.publish();
    }

    /**
     * Re-reads Settings and the override after either changes. A different effective port
     * restarts the listener; invalid values leave the running listener untouched.
     */
    async applyPortSources(): Promise<ServerStatus>
    {
        const resolution = this.resolvePort();
        if (Result.isFailure(resolution))
        {
            this.configurationError = describe(resolution.failure);
            this.log.warn(`Port change not applied: ${this.configurationError}`);
            return this.publish();
        }
        this.resolution = resolution;
        this.configurationError = undefined;
        const transport = this.host.getStatus();
        const needsRestart = transport.state !== "running"
            || transport.requestedPort !== resolution.success.requestedPort;
        if (this.wantRunning && needsRestart)
        {
            return this.start();
        }
        return this.publish();
    }

    async setPortOverride(port: number | undefined): Promise<ServerStatus>
    {
        if (port === undefined)
        {
            await this.overrides.reset();
        }
        else
        {
            await this.overrides.set(port);
        }
        return this.applyPortSources();
    }

    /** Keeps discovery data current when folders are added to or removed from the window. */
    refreshWorkspace(): void
    {
        this.debugger.refresh();
        if (this.host.getConnection())
        {
            this.writeRuntimeRecord();
        }
    }

    /** Refreshes the saved launch-profile snapshot after launch.json changes. */
    refreshDebugProfiles(): void
    {
        this.debugger.refresh();
    }

    pruneStaleRecords(): void
    {
        try
        {
            this.registry.pruneStale();
        }
        catch (error: unknown)
        {
            this.log.warn(`Could not prune stale runtime records: ${String(error)}`);
        }
    }

    dispose(): void
    {
        this.wantRunning = false;
        // Synchronous so discovery stops advertising this window even if shutdown is cut short.
        this.registry.remove(this.windowId);
        void this.host.stop().catch((error: unknown) => this.log.error(`Shutdown failed: ${String(error)}`));
        this.definitions.dispose();
        this.debugger.dispose();
        this.terminal.dispose();
        this.statusChanged.dispose();
    }

    private resolvePort(): StructuredResult<PortResolution>
    {
        return resolveRequestedPort(readPortSetting(), this.overrides.get());
    }

    private writeRuntimeRecord(): void
    {
        const connection = this.host.getConnection();
        if (!connection)
        {
            return;
        }
        const workspaceFile = vscode.workspace.workspaceFile?.scheme === "file"
            ? vscode.workspace.workspaceFile.fsPath
            : undefined;
        const record: RuntimeRecord = {
            endpoint: connection.endpoint,
            extensionVersion: this.extensionVersion,
            pid: process.pid,
            port: connection.port,
            requestedPort: connection.requestedPort,
            schema: 1,
            startedAt: new Date().toISOString(),
            token: connection.token,
            windowId: this.windowId,
            workspaceFile,
            workspaceFolders: (vscode.workspace.workspaceFolders ?? [])
                .filter((folder: vscode.WorkspaceFolder) => folder.uri.scheme === "file")
                .map((folder: vscode.WorkspaceFolder) => folder.uri.fsPath)
        };
        try
        {
            this.registry.write(record);
        }
        catch (error: unknown)
        {
            this.log.error(
                `Could not publish runtime discovery data; stdio bridges cannot connect: ${String(error)}`
            );
        }
    }

    private installLauncher(): void
    {
        try
        {
            installLauncher(this.paths, this.context.extensionPath, this.extensionVersion);
        }
        catch (error: unknown)
        {
            this.log.error(
                `Could not install the stdio bridge launcher at ${this.paths.launcherPath}: ${String(error)}`
            );
        }
    }

    private publish(): ServerStatus
    {
        const status = this.getStatus();
        this.definitions.refresh();
        this.statusChanged.fire(status);
        return status;
    }
}

function describe(error: { action?: string; message: string }): string
{
    return error.action ? `${error.message} ${error.action}` : error.message;
}
