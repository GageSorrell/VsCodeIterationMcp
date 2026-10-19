/**
 * @module vscode-iteration-mcp/Lifecycle/ExtensionController
 *
 * @file      ExtensionController.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

import * as vscode from "vscode";
import * as path from "node:path";
import { ServerController, type ServerStatus } from "../Mcp/ServerController";
import { buildHttpClientConfig, buildStdioClientConfig } from "../Mcp/ClientConfig";
import { isValidPort, parsePortInput } from "../Settings/PortResolution";
import { DisposableStore } from "../Core/Disposables";
import { McpDefinitionProviderId } from "../Mcp/DefinitionProvider";
import { Result } from "effect";
import { SettingPort } from "../Settings/Settings";
import { shouldStartServer } from "./WorkspaceTrust";
import { type InstallScope, chooseScopeContext } from "../Installation/ScopeService";
import { type SkillInstallReport, SkillInstaller } from "../Installation/SkillInstaller";
import { type AgentConfigReport, AgentConfigService } from "../Agents/AgentConfig";
import type { SupportedAgent } from "../Agents/AgentAdapters";
import { type SidebarMessage, SidebarProvider, type SidebarState } from "../Sidebar/SidebarProvider";
import { configPath } from "../Agents/AgentConfig";
import { skillPath } from "../Installation/SkillInstaller";

export { shouldStartServer } from "./WorkspaceTrust";

export interface ExtensionSmokeStatus
{
    readonly displayName: string;
    readonly serverStarted: boolean;
    readonly status: ServerStatus;
    readonly transportState: string;
    readonly trustedWorkspace: boolean;
}

/** Command IDs contributed in package.json; the sidebar (milestone 9) reuses them. */
export const Commands = {
    copyHttpConfig: "vscodeIterationMcp.copyHttpConfig",
    copyStdioConfig: "vscodeIterationMcp.copyStdioConfig",
    addToAgents: "vscodeIterationMcp.addToAgents",
    addProjectWorkspaceSettings: "vscodeIterationMcp.addProjectWorkspaceSettings",
    installSkill: "vscodeIterationMcp.installSkill",
    openPortSettings: "vscodeIterationMcp.openPortSettings",
    resetPortOverride: "vscodeIterationMcp.resetPortOverride",
    restartServer: "vscodeIterationMcp.restartServer",
    setPortOverride: "vscodeIterationMcp.setPortOverride",
    showStatus: "vscodeIterationMcp.showStatus",
    smokeTest: "vscodeIterationMcp.smokeTest",
    startServer: "vscodeIterationMcp.startServer",
    stopServer: "vscodeIterationMcp.stopServer"
} as const;

export class ExtensionController implements vscode.Disposable
{
    private readonly disposables: DisposableStore = new DisposableStore();

    private readonly log: vscode.LogOutputChannel;

    private readonly server: ServerController;

    private readonly skillInstaller: SkillInstaller;

    private readonly agentConfig: AgentConfigService;

    private readonly sidebar: SidebarProvider;

    private sidebarWatchers: Array<vscode.Disposable> = [];

    constructor(private readonly Context: vscode.ExtensionContext)
    {
        this.log = this.disposables.add(
            vscode.window.createOutputChannel("VS Code Iteration MCP", { log: true })
        );

        this.server = this.disposables.add(new ServerController(Context, this.log));
        this.skillInstaller = this.disposables.add(new SkillInstaller(Context));
        this.agentConfig = this.disposables.add(new AgentConfigService(
            Context,
            () => this.server.getStatus().port?.requestedPort ?? 0,
            () => this.server.launcherPath
        ));
        this.sidebar = this.disposables.add(new SidebarProvider(
            () => this.getSidebarState(),
            (message: SidebarMessage) => this.handleSidebarMessage(message)
        ));
    }

    async activate(): Promise<void>
    {
        this.registerCommands();
        this.registerDefinitionProvider();
        this.disposables.add(vscode.window.registerWebviewViewProvider(
            "vscodeIterationMcp.sidebar",
            this.sidebar,
            { webviewOptions: { retainContextWhenHidden: true } }
        ));
        this.disposables.add({ dispose: () => this.disposeSidebarWatchers() });
        this.registerSidebarWatchers();
        this.disposables.add(this.server.onDidChangeStatus(() => this.sidebar.refresh()));

        this.disposables.add(
            vscode.workspace.onDidChangeConfiguration((event: vscode.ConfigurationChangeEvent) =>
            {
                if (event.affectsConfiguration("launch"))
                {
                    this.server.refreshDebugProfiles();
                }
                if (event.affectsConfiguration(SettingPort))
                {
                    void this.server.applyPortSources()
                        .then((status: ServerStatus) =>
                        {
                            this.reportConfiguration(status);
                            this.sidebar.refresh();
                        });
                }
            }));

        this.disposables.add(
            vscode.workspace.onDidChangeWorkspaceFolders(() =>
            {
                this.server.refreshWorkspace();
                this.registerSidebarWatchers();
                this.sidebar.refresh();
            })
        );

        this.disposables.add(vscode.workspace.onDidGrantWorkspaceTrust(() =>
        {
            void this.server.start().then((status: ServerStatus) => this.reportStartFailure(status));
            this.sidebar.refresh();
        }));

        if (!shouldStartServer(vscode.workspace.isTrusted))
        {
            return;
        }
        this.server.pruneStaleRecords();
        this.reportStartFailure(await this.server.start());
        this.sidebar.refresh();
    }

    async showStatus(): Promise<void>
    {
        const status = this.server.getStatus();
        const port = status.port;
        const parts: Array<string> = [ `VS Code Iteration MCP is ${status.state}.` ];
        if (status.endpoint)
        {
            parts.push(`Endpoint: ${status.endpoint}.`);
        }
        if (port)
        {
            const override = port.overridePort !== undefined ? `, override ${port.overridePort}` : "";
            parts.push(
                `Requested port ${port.requestedPort} (from ${port.source}; Settings ` +
                `${port.settingPort}${override}).`
            );
        }
        if (status.actualPort !== undefined)
        {
            parts.push(`Bound port ${status.actualPort}.`);
        }
        if (status.message)
        {
            parts.push(status.message);
        }
        if (status.configurationError)
        {
            parts.push(`Not applied: ${status.configurationError}`);
        }

        const actions: Array<string> = status.state === "running"
            ? [ "Copy Stdio Configuration", "Copy HTTP Configuration", "Restart", "Stop" ]
            : [ "Start", "Open Settings" ];
        const choice = await vscode.window.showInformationMessage(parts.join(" "), ...actions);
        const commandByAction: Record<string, string> = {
            "Copy HTTP Configuration": Commands.copyHttpConfig,
            "Copy Stdio Configuration": Commands.copyStdioConfig,
            "Open Settings": Commands.openPortSettings,
            Restart: Commands.restartServer,
            Start: Commands.startServer,
            Stop: Commands.stopServer
        };
        if (choice !== undefined)
        {
            await vscode.commands.executeCommand(commandByAction[choice]);
        }
    }

    smokeTest(): ExtensionSmokeStatus
    {
        const status = this.server.getStatus();
        return {
            displayName: "VS Code Iteration MCP",
            serverStarted: status.state === "running",
            status,
            transportState: status.state,
            trustedWorkspace: vscode.workspace.isTrusted
        };
    }

    dispose(): void
    {
        this.disposables.dispose();
    }

    private registerCommands(): void
    {
        const register = (command: string, handler: (...args: Array<unknown>) => unknown): void =>
        {
            this.disposables.add(vscode.commands.registerCommand(command, handler));
        };

        register(Commands.showStatus, () => this.showStatus());
        register(Commands.smokeTest, () => this.smokeTest());
        register(Commands.startServer, async () => this.reportStartFailure(await this.server.start()));
        register(Commands.restartServer, async () => this.reportStartFailure(await this.server.start()));
        register(Commands.stopServer, () => this.server.stop());
        register(Commands.setPortOverride, (value?: unknown) => this.setPortOverride(value));
        register(
            Commands.resetPortOverride,
            async () => this.reportConfiguration(await this.server.setPortOverride(undefined))
        );
        register(
            Commands.openPortSettings,
            () => vscode.commands.executeCommand("workbench.action.openSettings", SettingPort)
        );
        register(Commands.copyHttpConfig, () => this.copyHttpConfig());
        register(Commands.copyStdioConfig, () => this.copyStdioConfig());
        register(Commands.addToAgents, (options?: unknown) => this.addToAgents(options));
        register(Commands.addProjectWorkspaceSettings, (options?: unknown) => this.addProjectWorkspaceSettings(options));
        register(Commands.installSkill, (scope?: unknown) => this.installSkill(scope));
    }

    private registerDefinitionProvider(): void
    {
        try
        {
            this.disposables.add(
                vscode.lm.registerMcpServerDefinitionProvider(
                    McpDefinitionProviderId,
                    this.server.definitions
                )
            );
        }
        catch (error: unknown)
        {
            // External clients still work through HTTP or the stdio bridge.
            this.log.warn(`VS Code's MCP definition provider API is unavailable: ${String(error)}`);
        }
    }

    private getSidebarState(): SidebarState
    {
        return {
            agents: this.agentConfig.inspectAll(),
            mismatches: this.agentConfig.detectProjectPortMismatches(),
            server: this.server.getStatus(),
            skills: this.skillInstaller.inspectAll()
        };
    }

    private async handleSidebarMessage(message: SidebarMessage): Promise<void>
    {
        if (message.type === "refresh")
        {
            this.sidebar.refresh();
            return;
        }
        if (message.type === "setPortOverride")
        {
            await vscode.commands.executeCommand(Commands.setPortOverride, message.value);
        }
        else
        {
            await vscode.commands.executeCommand(message.command);
        }
        this.sidebar.refresh();
    }

    private registerSidebarWatchers(): void
    {
        this.disposeSidebarWatchers();
        const refresh = (): void => this.sidebar.refresh();
        const patterns = [
            "**/.mcp.json",
            "**/.codex/config.toml",
            "**/.claude/skills/vscode-iteration-mcp/SKILL.md",
            "**/.agents/skills/vscode-iteration-mcp/SKILL.md"
        ];
        for (const folder of vscode.workspace.workspaceFolders ?? [])
        {
            if (folder.uri.scheme !== "file")
            {
                continue;
            }
            for (const pattern of patterns)
            {
                this.watchPattern(new vscode.RelativePattern(folder, pattern), refresh);
            }
        }
        const exactPaths = [
            configPath("claude-code", "user"),
            configPath("codex", "user"),
            configPath("claude-code", "system"),
            configPath("codex", "system"),
            skillPath("claude-code", "user"),
            skillPath("codex", "user"),
            skillPath("claude-code", "system"),
            skillPath("codex", "system")
        ];
        for (const filePath of exactPaths)
        {
            if (filePath !== undefined)
            {
                this.watchPattern(new vscode.RelativePattern(
                    vscode.Uri.file(path.dirname(filePath)),
                    path.basename(filePath)
                ), refresh);
            }
        }
    }

    private watchPattern(pattern: vscode.GlobPattern, refresh: () => void): void
    {
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);
        this.sidebarWatchers.push(
            watcher,
            watcher.onDidCreate(refresh),
            watcher.onDidChange(refresh),
            watcher.onDidDelete(refresh)
        );
    }

    private disposeSidebarWatchers(): void
    {
        for (const watcher of this.sidebarWatchers.splice(0))
        {
            watcher.dispose();
        }
    }

    /**
     * Applies a port override. A number or numeric string skips the prompt (used by the
     * sidebar and tests); blank input removes the override.
     */
    private async setPortOverride(value?: unknown): Promise<ServerStatus | undefined>
    {
        let port: number | undefined;
        if (typeof value === "number")
        {
            if (!isValidPort(value))
            {
                void vscode.window.showErrorMessage(
                    `${value} is not a valid port. Use an integer from 0 through 65535.`
                );
                return this.server.getStatus();
            }
            port = value;
        }
        else
        {
            const text = typeof value === "string"
                ? value
                : await vscode.window.showInputBox({
                    placeHolder: "Blank removes the override; 0 requests automatic assignment",
                    prompt: "Port override for this workspace (stored in workspace state, not Settings)",
                    title: "VS Code Iteration MCP: Port Override",
                    validateInput: (input: string) =>
                    {
                        const parsed = parsePortInput(input);
                        return Result.isFailure(parsed)
                            ? parsed.failure.action ?? parsed.failure.message
                            : undefined;
                    },
                    value: String(this.server.getStatus().port?.overridePort ?? "")
                });
            if (text === undefined)
            {
                return undefined;
            }
            const parsed = parsePortInput(text);
            if (Result.isFailure(parsed))
            {
                void vscode.window.showErrorMessage(
                    `${parsed.failure.message} ${parsed.failure.action ?? ""}`
                );
                return this.server.getStatus();
            }
            port = parsed.success;
        }
        const status = await this.server.setPortOverride(port);
        this.reportConfiguration(status);
        this.sidebar.refresh();
        return status;
    }

    private async copyHttpConfig(): Promise<void>
    {
        const connection = this.server.getConnection();
        if (!connection)
        {
            void vscode.window.showErrorMessage(
                "The VS Code Iteration MCP server is not running in this window."
            );
            return;
        }

        await vscode.env.clipboard.writeText(
            `${JSON.stringify(buildHttpClientConfig(connection), undefined, 2)}\n`
        );

        void vscode.window.showWarningMessage(
            "Copied HTTP configuration. It contains this window's bearer token, which stops working " +
            "when the window closes or reloads. Do not commit it; " +
            "prefer the stdio configuration for durable setups."
        );
    }

    private async copyStdioConfig(): Promise<void>
    {
        const port = this.server.getStatus().port;
        const workspace = vscode.workspace.workspaceFile?.scheme === "file"
            ? vscode.workspace.workspaceFile.fsPath
            : vscode.workspace.workspaceFolders
                ?.find((folder: vscode.WorkspaceFolder) => folder.uri.scheme === "file")?.uri.fsPath;
        const config = buildStdioClientConfig({
            launcherPath: this.server.launcherPath,
            requestedPort: port?.requestedPort ?? 0,
            workspace
        });
        await vscode.env.clipboard.writeText(`${JSON.stringify(config, undefined, 2)}\n`);
        void vscode.window.showInformationMessage(
            "Copied stdio configuration. It contains no credentials; the bridge requires Node.js on PATH and "
            + "connects to whichever window owns the workspace."
        );
    }

    private async installSkill(scope?: unknown): Promise<SkillInstallReport | undefined>
    {
        const selectedScope = parseScope(scope);
        const scopeContext = selectedScope === undefined
            ? await chooseScopeContext()
            : { scope: selectedScope };
        if (scopeContext === undefined)
        {
            return undefined;
        }
        try
        {
            const report = await this.skillInstaller.install(scopeContext);
            const lines = report.results.map((result) =>
            {
                const target = result.path ?? "native destination unavailable";
                return `${result.agent} ${result.status}: ${target}${result.message ? ` (${result.message})` : ""}`;
            });
            void vscode.window.showInformationMessage(
                `VS Code Iteration MCP skill installation (${report.scope}) completed. ${lines.join("; ")}`
            );
            this.sidebar.refresh();
            return report;
        }
        catch (error: unknown)
        {
            const message = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(`VS Code Iteration MCP skill installation failed: ${message}`);
            return undefined;
        }
    }

    private async addToAgents(options?: unknown): Promise<AgentConfigReport | undefined>
    {
        const parsed = parseAgentConfigOptions(options);
        let fixedScope: { scope: InstallScope; workspaceFolder?: vscode.WorkspaceFolder } | undefined;
        if (parsed.scope !== undefined)
        {
            fixedScope = parsed.scope === "project"
                ? {
                    scope: "project",
                    ...(vscode.workspace.workspaceFolders?.[0] === undefined
                        ? {}
                        : { workspaceFolder: vscode.workspace.workspaceFolders[0] })
                }
                : { scope: parsed.scope };
        }
        try
        {
            const report = parsed.agents !== undefined && fixedScope !== undefined
                ? await this.agentConfig.install(parsed.agents, fixedScope)
                : await this.agentConfig.configure(parsed.agents, fixedScope);
            if (report !== undefined)
            {
                this.reportAgentConfig(report);
                this.sidebar.refresh();
            }
            return report;
        }
        catch (error: unknown)
        {
            const message = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(`VS Code Iteration MCP agent configuration failed: ${message}`);
            return undefined;
        }
    }

    private async addProjectWorkspaceSettings(options?: unknown): Promise<AgentConfigReport | undefined>
    {
        const mismatches = this.agentConfig.detectProjectPortMismatches();
        if (mismatches.length === 0)
        {
            void vscode.window.showInformationMessage(
                "No project MCP configuration is currently mismatched with this workspace's requested port."
            );
            return undefined;
        }
        try
        {
            const parsed = parseAgentConfigOptions(options);
            const report = parsed.agents !== undefined && vscode.workspace.workspaceFolders?.[0] !== undefined
                ? await this.agentConfig.install(parsed.agents, {
                    scope: "project",
                    workspaceFolder: vscode.workspace.workspaceFolders[0]
                })
                : await this.agentConfig.configureProjectWorkspaceSettings(mismatches);
            if (report !== undefined)
            {
                this.reportAgentConfig(report);
                this.sidebar.refresh();
            }
            return report;
        }
        catch (error: unknown)
        {
            const message = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(`VS Code Iteration MCP project configuration failed: ${message}`);
            return undefined;
        }
    }

    private reportAgentConfig(report: AgentConfigReport): void
    {
        const lines = report.results.map((result) =>
        {
            const target = result.path ?? "native destination unavailable";
            return `${result.agent} ${result.status}: ${target}${result.message ? ` (${result.message})` : ""}`;
        });
        void vscode.window.showInformationMessage(
            `VS Code Iteration MCP agent configuration (${report.scope}) completed. ${lines.join("; ")}`
        );
    }

    private reportStartFailure(status: ServerStatus): ServerStatus
    {
        if (status.state === "error" || (status.state === "stopped" && status.configurationError))
        {
            void vscode.window.showErrorMessage(
                `VS Code Iteration MCP could not start: ${status.message ?? status.configurationError}`,
                "Open Settings"
            )
                .then((choice: string | undefined) =>
                {
                    if (choice)
                    {
                        void vscode.commands.executeCommand(Commands.openPortSettings);
                    }
                });
        }
        return status;
    }

    private reportConfiguration(status: ServerStatus): ServerStatus
    {
        if (status.configurationError)
        {
            void vscode.window.showWarningMessage(
                `VS Code Iteration MCP kept its current listener: ${status.configurationError}`
            );
            return status;
        }
        return this.reportStartFailure(status);
    }
}

function parseScope(value: unknown): InstallScope | undefined
{
    return value === "project" || value === "user" || value === "system" ? value : undefined;
}

function parseAgentConfigOptions(value: unknown): {
    agents?: ReadonlyArray<SupportedAgent>;
    scope?: InstallScope;
}
{
    if (value === null || typeof value !== "object")
    {
        return {};
    }
    const record = value as Record<string, unknown>;
    const agents = Array.isArray(record.agents)
        ? record.agents.filter((agent): agent is SupportedAgent => agent === "claude-code" || agent === "codex")
        : undefined;
    return {
        ...(agents === undefined ? {} : { agents }),
        scope: parseScope(record.scope)
    };
}
