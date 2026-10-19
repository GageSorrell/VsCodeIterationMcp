/**
 * @module vscode-iteration-mcp/Agents/AgentConfig
 *
 * @file      AgentConfig.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { AGENT_ADAPTERS, type SupportedAgent } from "./AgentAdapters";
import { ActionableError } from "../Core/Errors";
import { buildBridgeArgs } from "../Mcp/ClientConfig";
import { writeFileAtomicSync } from "../Runtime/FileUtils";
import { getSharedLauncherPath, installSharedLauncher } from "../Runtime/LauncherInstaller";
import { type InstallScope, type ScopeContext, chooseProjectContext, chooseScopeContext } from "../Installation/ScopeService";
import { resolveHomeDirectory } from "../Installation/SkillInstaller";

export type AgentConfigInspectionStatus =
    | "configured"
    | "malformed"
    | "missing"
    | "stale"
    | "unreadable"
    | "unsupported";

export type AgentConfigInstallStatus =
    | "cancelled"
    | "error"
    | "installed"
    | "unchanged"
    | "unsupported"
    | "updated";

export interface AgentConfigTarget
{
    agent: SupportedAgent;
    format: "json" | "toml";
    path?: string;
    scope: InstallScope;
    workspaceFolder?: string;
}

export interface AgentConfigInspection
{
    agent: SupportedAgent;
    effective?: boolean;
    hasServer: boolean;
    message?: string;
    path?: string;
    requestedPort?: number;
    scope: InstallScope;
    status: AgentConfigInspectionStatus;
    workspaceFolder?: string;
}

export interface AgentConfigResult
{
    agent: SupportedAgent;
    message?: string;
    path?: string;
    scope: InstallScope;
    status: AgentConfigInstallStatus;
    workspaceFolder?: string;
}

export interface AgentConfigReport
{
    requestedPort: number;
    results: ReadonlyArray<AgentConfigResult>;
    scope: InstallScope;
    workspaceFolder?: string;
}

export interface ProjectPortMismatch
{
    agent: SupportedAgent;
    configuredPort: number;
    existingPath: string;
    root: string;
    workspacePort: number;
}

interface FileState
{
    content?: string;
    exists: boolean;
    readable: boolean;
}

interface ConfigPlan
{
    desired: Record<string, unknown>;
    existingEntry?: unknown;
    snapshot: FileState;
    target: AgentConfigTarget;
    result: AgentConfigResult;
}

interface JsonConfig
{
    [key: string]: unknown;
}

interface TomlEntry
{
    args?: Array<string>;
    command?: string;
    url?: string;
}

interface TomlParse
{
    entry?: TomlEntry;
}

interface AgentPickItem extends vscode.QuickPickItem
{
    agent: SupportedAgent;
}

const ServerName = "vscode-iteration-mcp";

/** Handles native Claude Code and Codex MCP configuration without touching unrelated entries. */
export class AgentConfigService implements vscode.Disposable
{
    private readonly extensionRoot: string;

    constructor(
        context: vscode.ExtensionContext,
        private readonly getRequestedPort: () => number,
        private readonly getUserLauncherPath: () => string
    )
    {
        this.extensionRoot = context.extensionPath;
    }

    async chooseAgents(preselected?: ReadonlyArray<SupportedAgent>): Promise<ReadonlyArray<SupportedAgent> | undefined>
    {
        const initial = new Set(preselected ?? this.detectConfiguredAgents());
        for (;;)
        {
            const selected = await vscode.window.showQuickPick<AgentPickItem>(
                AGENT_ADAPTERS.map((adapter) => ({
                    agent: adapter.id,
                    label: adapter.displayName,
                    picked: initial.has(adapter.id)
                })),
                {
                    canPickMany: true,
                    placeHolder: "Select at least one agent to configure",
                    title: "VS Code Iteration MCP: Add MCP Server to Agents"
                }
            );
            if (selected === undefined)
            {
                return undefined;
            }
            if (selected.length > 0)
            {
                return selected.map((item) => item.agent);
            }
            void vscode.window.showErrorMessage("Select Claude Code, Codex, or both before continuing.");
        }
    }

    async configure(
        preselected?: ReadonlyArray<SupportedAgent>,
        fixedScope?: ScopeContext
    ): Promise<AgentConfigReport | undefined>
    {
        const agents = await this.chooseAgents(preselected);
        if (agents === undefined)
        {
            return undefined;
        }
        const scopeContext = fixedScope ?? await chooseScopeContext();
        if (scopeContext === undefined)
        {
            return undefined;
        }
        return this.install(agents, scopeContext);
    }

    async configureProjectWorkspaceSettings(
        mismatches: ReadonlyArray<ProjectPortMismatch>
    ): Promise<AgentConfigReport | undefined>
    {
        const agents = await this.chooseAgents([ ...new Set(mismatches.map((mismatch) => mismatch.agent)) ]);
        if (agents === undefined)
        {
            return undefined;
        }
        const scopeContext = await chooseProjectContext();
        if (scopeContext === undefined)
        {
            return undefined;
        }
        return this.install(agents, scopeContext);
    }

    inspect(scope: InstallScope, workspaceFolder?: vscode.WorkspaceFolder): ReadonlyArray<AgentConfigInspection>
    {
        return AGENT_ADAPTERS.map(({ id }) => this.inspectTarget({
            agent: id,
            format: id === "claude-code" ? "json" : "toml",
            path: configPath(id, scope, workspaceFolder?.uri.scheme === "file" ? workspaceFolder.uri.fsPath : undefined),
            scope,
            ...(workspaceFolder?.uri.fsPath === undefined ? {} : { workspaceFolder: workspaceFolder.uri.fsPath })
        })).map((inspection) =>
        {
            let result = inspection;
            if (scope === "project" && inspection.agent === "claude-code" && workspaceFolder?.uri.scheme === "file"
                && !inspection.hasServer)
            {
                result = this.inspectClaudeProjectEntry(inspection, workspaceFolder.uri.fsPath);
            }
            return this.markStale(result);
        });
    }

    inspectAll(): ReadonlyArray<AgentConfigInspection>
    {
        const result: Array<AgentConfigInspection> = [];
        for (const folder of vscode.workspace.workspaceFolders ?? [])
        {
            result.push(...this.inspect("project", folder));
        }
        result.push(...this.inspect("user"));
        result.push(...this.inspect("system"));
        return result;
    }

    detectConfiguredAgents(): ReadonlyArray<SupportedAgent>
    {
        const configured: Array<SupportedAgent> = [];
        for (const adapter of AGENT_ADAPTERS)
        {
            const targets: Array<AgentConfigTarget> = [
                ...[ ...(vscode.workspace.workspaceFolders ?? []) ].map((folder) => ({
                    agent: adapter.id,
                    format: adapter.id === "claude-code" ? "json" as const : "toml" as const,
                    path: configPath(adapter.id, "project", folder.uri.scheme === "file" ? folder.uri.fsPath : undefined),
                    scope: "project" as const
                })),
                {
                    agent: adapter.id,
                    format: adapter.id === "claude-code" ? "json" : "toml",
                    path: configPath(adapter.id, "user"),
                    scope: "user"
                },
                {
                    agent: adapter.id,
                    format: adapter.id === "claude-code" ? "json" : "toml",
                    path: configPath(adapter.id, "system"),
                    scope: "system"
                }
            ];
            if (targets.some((target) => target.path !== undefined && exists(target.path)))
            {
                configured.push(adapter.id);
            }
        }
        return configured;
    }

    detectProjectPortMismatches(): ReadonlyArray<ProjectPortMismatch>
    {
        const workspacePort = this.getRequestedPort();
        const mismatches: Array<ProjectPortMismatch> = [];
        for (const folder of vscode.workspace.workspaceFolders ?? [])
        {
            if (folder.uri.scheme !== "file")
            {
                continue;
            }
            for (const { id } of AGENT_ADAPTERS)
            {
                const projectTarget = this.target(id, "project", folder.uri.fsPath);
                const projectInspection = this.inspectTarget(projectTarget);
                if (projectInspection.hasServer || this.findClaudeProjectEntry(folder.uri.fsPath) !== undefined)
                {
                    continue;
                }
                const nonProject = [
                    this.target(id, "user"),
                    this.target(id, "system")
                ];
                const existing = nonProject
                    .map((target) => this.findEntry(target, folder.uri.fsPath))
                    .find((entry): entry is { path: string; port: number } =>
                        entry !== undefined && entry.port !== undefined
                    );
                if (existing && existing.port !== workspacePort)
                {
                    mismatches.push({
                        agent: id,
                        configuredPort: existing.port,
                        existingPath: existing.path,
                        root: folder.uri.fsPath,
                        workspacePort
                    });
                }
            }
        }
        return mismatches;
    }

    async install(
        agents: ReadonlyArray<SupportedAgent>,
        scopeContext: ScopeContext
    ): Promise<AgentConfigReport>
    {
        const requestedPort = this.getRequestedPort();
        const targets = agents.map((agent) => this.target(
            agent,
            scopeContext.scope,
            scopeContext.workspaceFolder?.uri.scheme === "file"
                ? scopeContext.workspaceFolder.uri.fsPath
                : undefined
        ));
        if (scopeContext.scope === "project" && targets.some((target) => target.workspaceFolder === undefined))
        {
            throw new ActionableError({
                action: "Choose an open local workspace root and retry.",
                code: "NOT_READY",
                message: "Project MCP configuration requires a local file workspace root."
            });
        }
        if (scopeContext.scope === "project" && scopeContext.workspaceFolder !== undefined)
        {
            const root = scopeContext.workspaceFolder.uri.fsPath;
            const stillOpen = [ ...(vscode.workspace.workspaceFolders ?? []) ].some((folder) =>
                folder.uri.scheme === "file" && normalizePath(folder.uri.fsPath) === normalizePath(root)
            );
            if (!stillOpen)
            {
                throw new ActionableError({
                    action: "Reopen the selected workspace root and retry.",
                    code: "NOT_READY",
                    message: "The selected Project workspace root is no longer open."
                });
            }
        }
        if (scopeContext.scope === "system")
        {
            const destinations = targets.map((target) => target.path ?? `${target.agent}: unsupported on native Windows`);
            const choice = await vscode.window.showWarningMessage(
                "System MCP installation writes to " + `${destinations.join("; ")}. ` +
                "Claude Code managed MCP configuration can suppress other scopes. " +
                "Codex System remains unsupported until a native Windows destination is verified.",
                "Continue",
                "Cancel"
            );
            if (choice !== "Continue")
            {
                return {
                    requestedPort,
                    results: targets.map((target) => ({
                        agent: target.agent,
                        message: target.path === undefined
                            ? "Codex System MCP configuration has no verified native Windows destination."
                            : "System installation cancelled before any files were changed.",
                        path: target.path,
                        scope: target.scope,
                        status: target.path === undefined ? "unsupported" as const : "cancelled" as const
                    })),
                    scope: scopeContext.scope
                };
            }
        }

        const plans = targets.map((target) => this.plan(target, requestedPort));
        for (const plan of plans)
        {
            if (plan.target.path === undefined || plan.result.status === "unsupported"
                || plan.result.status === "error" || plan.result.status === "unchanged")
            {
                continue;
            }
            const current = readFileState(plan.target.path);
            if (!sameState(current, plan.snapshot))
            {
                plan.result = {
                    ...plan.result,
                    message: "The configuration changed while the installation was running; it was not overwritten.",
                    status: "error"
                };
                continue;
            }
            try
            {
                if (scopeContext.scope === "system" && plan.target.agent === "claude-code")
                {
                    installSharedLauncher(this.extensionRoot, getSharedLauncherPath());
                }
                if (plan.snapshot.exists)
                {
                    const backupPath = createBackup(plan.target.path);
                    this.writeTarget(plan.target, plan.snapshot.content ?? "", plan.desired);
                    plan.result = {
                        ...plan.result,
                        message: joinMessages(
                            `Backup created at ${backupPath}.`,
                            projectPolicyMessage(plan.target)
                        ),
                        status: "updated"
                    };
                }
                else
                {
                    this.writeTarget(plan.target, "", plan.desired);
                    plan.result = {
                        ...plan.result,
                        message: projectPolicyMessage(plan.target),
                        status: "installed"
                    };
                }
            }
            catch (error: unknown)
            {
                plan.result = {
                    ...plan.result,
                    message: error instanceof Error ? error.message : String(error),
                    status: "error"
                };
            }
        }
        return {
            requestedPort,
            results: plans.map((plan) => plan.result),
            scope: scopeContext.scope,
            ...(scopeContext.workspaceFolder === undefined
                ? {}
                : { workspaceFolder: scopeContext.workspaceFolder.uri.fsPath })
        };
    }

    dispose(): void
    {
        // No long-lived resources are owned by the adapter service.
    }

    private target(agent: SupportedAgent, scope: InstallScope, workspacePath?: string): AgentConfigTarget
    {
        return {
            agent,
            format: agent === "claude-code" ? "json" : "toml",
            path: configPath(agent, scope, workspacePath),
            scope,
            ...(workspacePath === undefined ? {} : { workspaceFolder: workspacePath })
        };
    }

    private plan(target: AgentConfigTarget, requestedPort: number): ConfigPlan
    {
        if (target.path === undefined)
        {
            return {
                desired: {},
                snapshot: { exists: false, readable: false },
                target,
                result: {
                    agent: target.agent,
                    message: "Codex System MCP configuration has no verified native Windows destination.",
                    scope: target.scope,
                    status: "unsupported"
                }
            };
        }
        const desired = desiredEntry(target, requestedPort, this.getUserLauncherPath());
        const snapshot = readFileState(target.path);
        if (!snapshot.exists)
        {
            return {
                desired,
                snapshot,
                target,
                result: basicResult(target, "installed", projectPolicyMessage(target))
            };
        }
        if (!snapshot.readable || snapshot.content === undefined)
        {
            return {
                desired,
                snapshot,
                target,
                result: basicResult(target, "error", "The existing configuration is unreadable; it was left untouched.")
            };
        }
        try
        {
            const parsed = target.format === "json"
                ? inspectClaudeJson(snapshot.content, target, desired)
                : inspectCodexToml(snapshot.content, desired);
            return {
                desired,
                existingEntry: parsed.entry,
                snapshot,
                target,
                result: basicResult(target, parsed.entry === undefined
                    ? "installed"
                    : parsed.matches ? "unchanged" : "updated",
                joinMessages(parsed.message, projectPolicyMessage(target)))
            };
        }
        catch (error: unknown)
        {
            return {
                desired,
                snapshot,
                target,
                result: basicResult(target, "error", `The existing configuration is malformed: ${error instanceof Error ? error.message : String(error)}`)
            };
        }
    }

    private inspectTarget(target: AgentConfigTarget): AgentConfigInspection
    {
        if (target.path === undefined)
        {
            return {
                agent: target.agent,
                hasServer: false,
                message: "Codex System MCP configuration has no verified native Windows destination.",
                scope: target.scope,
                status: "unsupported"
            };
        }
        const state = readFileState(target.path);
        if (!state.exists)
        {
            return { agent: target.agent, hasServer: false, path: target.path, scope: target.scope, status: "missing" };
        }
        if (!state.readable || state.content === undefined)
        {
            return { agent: target.agent, hasServer: false, message: "The configuration is unreadable.", path: target.path, scope: target.scope, status: "unreadable" };
        }
        try
        {
            const entry = target.format === "json"
                ? findClaudeEntry(JSON.parse(stripBom(state.content)) as unknown, target)
                : parseCodexToml(state.content).entry;
            const policyMessage = managedPolicyMessage(target);
            return {
                agent: target.agent,
                ...(policyMessage === undefined ? {} : { effective: false }),
                hasServer: entry !== undefined,
                message: policyMessage,
                path: target.path,
                requestedPort: extractPort(entry),
                scope: target.scope,
                status: entry === undefined ? "missing" : "configured"
            };
        }
        catch (error: unknown)
        {
            return {
                agent: target.agent,
                hasServer: false,
                message: `The configuration is malformed: ${error instanceof Error ? error.message : String(error)}`,
                path: target.path,
                scope: target.scope,
                status: "malformed"
            };
        }
    }

    private markStale(inspection: AgentConfigInspection): AgentConfigInspection
    {
        if (!inspection.hasServer || inspection.requestedPort === undefined
            || inspection.requestedPort === this.getRequestedPort()
            || inspection.status !== "configured")
        {
            return inspection;
        }
        return {
            ...inspection,
            message: joinMessages(
                inspection.message,
                `Configured port ${inspection.requestedPort} differs from this workspace's requested port ${this.getRequestedPort()}.`
            ),
            status: "stale"
        };
    }

    private findEntry(target: AgentConfigTarget, root: string): { path: string; port?: number } | undefined
    {
        if (target.path === undefined)
        {
            return undefined;
        }
        const state = readFileState(target.path);
        if (!state.exists || !state.readable || state.content === undefined)
        {
            return undefined;
        }
        try
        {
            const entry = target.format === "json"
                ? findClaudeEntry(JSON.parse(stripBom(state.content)) as unknown, target, root)
                : parseCodexToml(state.content).entry;
            const port = extractPort(entry);
            return entry === undefined ? undefined : { path: target.path, port };
        }
        catch
        {
            return undefined;
        }
    }

    private findClaudeProjectEntry(root: string): unknown
    {
        const userPath = configPath("claude-code", "user");
        if (userPath === undefined || !exists(userPath))
        {
            return undefined;
        }
        const state = readFileState(userPath);
        if (!state.readable || state.content === undefined)
        {
            return undefined;
        }
        try
        {
            return findClaudeProjectEntry(JSON.parse(stripBom(state.content)) as unknown, root);
        }
        catch
        {
            return undefined;
        }
    }

    private inspectClaudeProjectEntry(
        base: AgentConfigInspection,
        root: string
    ): AgentConfigInspection
    {
        const userPath = configPath("claude-code", "user");
        if (userPath === undefined)
        {
            return base;
        }
        const state = readFileState(userPath);
        if (!state.exists)
        {
            return base;
        }
        if (!state.readable || state.content === undefined)
        {
            return {
                ...base,
                message: "The Claude Code user configuration is unreadable.",
                path: userPath,
                status: "unreadable"
            };
        }
        try
        {
            const entry = findClaudeProjectEntry(JSON.parse(stripBom(state.content)) as unknown, root);
            if (entry === undefined)
            {
                return base;
            }
            const policyMessage = managedPolicyMessage({
                agent: "claude-code",
                format: "json",
                path: userPath,
                scope: "user"
            });
            return {
                ...base,
                ...(policyMessage === undefined ? {} : { effective: false }),
                hasServer: true,
                message: policyMessage,
                path: userPath,
                requestedPort: extractPort(entry),
                status: "configured"
            };
        }
        catch (error: unknown)
        {
            return {
                ...base,
                hasServer: false,
                message: `The Claude Code user configuration is malformed: ${error instanceof Error ? error.message : String(error)}`,
                path: userPath,
                status: "malformed"
            };
        }
    }

    private writeTarget(target: AgentConfigTarget, content: string, desired: Record<string, unknown>): void
    {
        const output = target.format === "json"
            ? writeClaudeJson(content, desired)
            : writeCodexToml(content, desired);
        writeFileAtomicSync(target.path!, output, 0o600);
    }
}

export function configPath(
    agent: SupportedAgent,
    scope: InstallScope,
    workspacePath?: string,
    env: NodeJS.ProcessEnv = process.env
): string | undefined
{
    if (agent === "claude-code")
    {
        if (scope === "project")
        {
            return workspacePath === undefined ? undefined : path.join(workspacePath, ".mcp.json");
        }
        if (scope === "user")
        {
            return path.join(resolveHomeDirectory(env), ".claude.json");
        }
        return process.platform === "win32"
            ? path.join(env.ProgramFiles ?? "C:\\Program Files", "ClaudeCode", "managed-mcp.json")
            : undefined;
    }
    if (scope === "project")
    {
        return workspacePath === undefined ? undefined : path.join(workspacePath, ".codex", "config.toml");
    }
    if (scope === "user")
    {
        return path.join(
            env.VSCODE_ITERATION_MCP_CODEX_HOME
                ?? env.CODEX_HOME
                ?? path.join(resolveHomeDirectory(env), ".codex"),
            "config.toml"
        );
    }
    return undefined;
}

function desiredEntry(
    target: AgentConfigTarget,
    requestedPort: number,
    userLauncherPath: string
): Record<string, unknown>
{
    const launcherPath = target.scope === "system" ? getSharedLauncherPath() : userLauncherPath;
    const args = buildBridgeArgs({
        launcherPath,
        requestedPort,
        workspace: target.scope === "project" ? target.workspaceFolder : undefined
    });
    return target.agent === "claude-code"
        ? { args, command: "node", type: "stdio" }
        : { args, command: "node" };
}

function basicResult(target: AgentConfigTarget, status: AgentConfigInstallStatus, message?: string): AgentConfigResult
{
    return {
        agent: target.agent,
        message,
        path: target.path,
        scope: target.scope,
        status,
        ...(target.workspaceFolder === undefined ? {} : { workspaceFolder: target.workspaceFolder })
    };
}

function managedPolicyMessage(target: AgentConfigTarget): string | undefined
{
    if (target.agent !== "claude-code" || target.scope === "system")
    {
        return undefined;
    }
    const managedPath = configPath("claude-code", "system");
    if (managedPath === undefined || !exists(managedPath))
    {
        return undefined;
    }
    return `Claude Code managed MCP policy at ${managedPath} may take exclusive control and suppress this ${target.scope} entry; an administrator must allow that scope's MCP servers for it to become effective.`;
}

function projectPolicyMessage(target: AgentConfigTarget): string | undefined
{
    return target.scope === "project" ? managedPolicyMessage(target) : undefined;
}

function joinMessages(...messages: Array<string | undefined>): string | undefined
{
    const present = messages.filter((message): message is string => message !== undefined && message.length > 0);
    return present.length > 0 ? present.join(" ") : undefined;
}

function inspectClaudeJson(
    content: string,
    target: AgentConfigTarget,
    desired: Record<string, unknown>
): { entry?: unknown; matches: boolean; message?: string }
{
    const parsed = JSON.parse(stripBom(content)) as unknown;
    const entry = findClaudeEntry(parsed, target);
    return { entry, matches: entry !== undefined && deepEqual(entry, desired) };
}

function findClaudeEntry(value: unknown, target: AgentConfigTarget, root?: string): unknown
{
    if (!isRecord(value))
    {
        throw new Error("top-level JSON value must be an object");
    }
    const global = getServerMap(value);
    if (global !== undefined && Object.prototype.hasOwnProperty.call(global, ServerName))
    {
        return global[ServerName];
    }
    if (target.scope === "project" && root !== undefined)
    {
        return findClaudeProjectEntry(value, root);
    }
    if (target.scope === "project" && isRecord(value.projects))
    {
        const project = Object.values(value.projects).find((candidate) => isRecord(candidate));
        const projectServers = isRecord(project) ? getServerMap(project) : undefined;
        return projectServers?.[ServerName];
    }
    return undefined;
}

function findClaudeProjectEntry(value: unknown, root: string): unknown
{
    if (!isRecord(value))
    {
        throw new Error("top-level JSON value must be an object");
    }
    if (!isRecord(value.projects))
    {
        return undefined;
    }
    const project = Object.entries(value.projects).find(([ projectRoot ]) =>
        normalizePath(projectRoot) === normalizePath(root)
    )?.[1];
    if (!isRecord(project))
    {
        return undefined;
    }
    const projectServers = getServerMap(project);
    return projectServers?.[ServerName];
}

function getServerMap(value: JsonConfig): JsonConfig | undefined
{
    if (value.mcpServers === undefined)
    {
        return undefined;
    }
    if (!isRecord(value.mcpServers))
    {
        throw new Error("mcpServers must be an object");
    }
    return value.mcpServers;
}

function writeClaudeJson(content: string, desired: Record<string, unknown>): string
{
    const parsed: JsonConfig = content.length === 0
        ? {}
        : JSON.parse(stripBom(content)) as JsonConfig;
    if (!isRecord(parsed))
    {
        throw new Error("top-level JSON value must be an object");
    }
    const servers = parsed.mcpServers === undefined ? {} : parsed.mcpServers;
    if (!isRecord(servers))
    {
        throw new Error("mcpServers must be an object");
    }
    servers[ServerName] = desired;
    parsed.mcpServers = servers;
    return `${JSON.stringify(parsed, undefined, 2)}\n`;
}

function inspectCodexToml(content: string, desired: Record<string, unknown>): { entry?: TomlEntry; matches: boolean; message?: string }
{
    const parsed = parseCodexToml(content);
    const entry = parsed.entry;
    return {
        entry,
        matches: entry !== undefined
            && deepEqual(entry, { args: desired.args, command: desired.command })
    };
}

function parseCodexToml(content: string): TomlParse
{
    const lines = logicalTomlLines(content);
    let table: string | undefined;
    let entry: TomlEntry | undefined;
    for (const line of lines)
    {
        const clean = stripTomlComment(line).trim();
        if (clean.length === 0)
        {
            continue;
        }
        const header = /^\[([^\]]+)\]$/.exec(clean);
        if (header)
        {
            table = header[1].trim();
            if (table === `mcp_servers.${ServerName}`)
            {
                entry = {};
            }
            continue;
        }
        if (/^\[\[/.test(clean))
        {
            table = undefined;
            continue;
        }
        const assignment = /^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/.exec(clean);
        if (!assignment)
        {
            throw new Error(`invalid TOML line '${clean}'`);
        }
        if (table === `mcp_servers.${ServerName}` && entry !== undefined)
        {
            if (assignment[1] === "command")
            {
                const value = parseTomlString(assignment[2]);
                if (value === undefined)
                {
                    throw new Error("mcp server command must be a string");
                }
                entry.command = value;
            }
            if (assignment[1] === "args")
            {
                const value = parseTomlStringArray(assignment[2]);
                if (value === undefined)
                {
                    throw new Error("mcp server args must be an array of strings");
                }
                entry.args = value;
            }
            if (assignment[1] === "url")
            {
                const value = parseTomlString(assignment[2]);
                if (value === undefined)
                {
                    throw new Error("mcp server url must be a string");
                }
                entry.url = value;
            }
        }
    }
    return { entry };
}

function writeCodexToml(content: string, desired: Record<string, unknown>): string
{
    const block = [
        `[mcp_servers.${ServerName}]`,
        `command = ${JSON.stringify(desired.command)}`,
        `args = ${JSON.stringify(desired.args)}`
    ].join("\n");
    const lines = content.split(/\r?\n/);
    const start = lines.findIndex((line) => line.trim() === `[mcp_servers.${ServerName}]`);
    if (start < 0)
    {
        const prefix = content.length > 0 && !content.endsWith("\n") ? `${content}\n` : content;
        return `${prefix}${prefix.length > 0 ? "\n" : ""}${block}\n`;
    }
    let end = start + 1;
    while (end < lines.length && !/^\s*\[/.test(lines[end]))
    {
        end++;
    }
    const output = [ ...lines.slice(0, start), ...block.split("\n"), ...lines.slice(end) ].join("\n");
    return output.endsWith("\n") ? output : `${output}\n`;
}

function logicalTomlLines(content: string): Array<string>
{
    const output: Array<string> = [];
    let pending = "";
    for (const line of content.split(/\r?\n/))
    {
        pending = pending.length === 0 ? line : `${pending}\n${line}`;
        if (balancedTomlValue(pending))
        {
            output.push(pending);
            pending = "";
        }
    }
    if (pending.trim().length > 0)
    {
        throw new Error("unterminated TOML value");
    }
    return output;
}

function balancedTomlValue(value: string): boolean
{
    let brackets = 0;
    let quote: string | undefined;
    let escaped = false;
    for (let index = 0; index < value.length; index++)
    {
        const character = value[index];
        if (quote !== undefined)
        {
            if (quote === "\"" && escaped)
            {
                escaped = false;
            }
            else if (quote === "\"" && character === "\\")
            {
                escaped = true;
            }
            else if (character === quote)
            {
                quote = undefined;
            }
            continue;
        }
        if (character === "\"" || character === "'")
        {
            quote = character;
        }
        else if (character === "#")
        {
            while (index < value.length && value[index] !== "\n")
            {
                index++;
            }
        }
        else if (character === "[")
        {
            brackets++;
        }
        else if (character === "]")
        {
            brackets--;
        }
    }
    return quote === undefined && brackets <= 0;
}

function stripTomlComment(value: string): string
{
    let quote: string | undefined;
    let escaped = false;
    let inComment = false;
    let output = "";
    for (let index = 0; index < value.length; index++)
    {
        const character = value[index];
        if (inComment)
        {
            if (character === "\n")
            {
                inComment = false;
                output += character;
            }
            continue;
        }
        if (quote !== undefined)
        {
            if (quote === "\"" && escaped)
            {
                escaped = false;
            }
            else if (quote === "\"" && character === "\\")
            {
                escaped = true;
            }
            else if (character === quote)
            {
                quote = undefined;
            }
        }
        else if (character === "\"" || character === "'")
        {
            quote = character;
        }
        else if (character === "#")
        {
            inComment = true;
            continue;
        }
        output += character;
    }
    return output;
}

function parseTomlString(value: string): string | undefined
{
    const trimmed = value.trim();
    if (trimmed.startsWith("\"") && trimmed.endsWith("\""))
    {
        try
        {
            const parsed: unknown = JSON.parse(trimmed);
            return typeof parsed === "string" ? parsed : undefined;
        }
        catch
        {
            return undefined;
        }
    }
    if (trimmed.startsWith("'") && trimmed.endsWith("'"))
    {
        return trimmed.slice(1, -1);
    }
    return undefined;
}

function parseTomlStringArray(value: string): Array<string> | undefined
{
    const trimmed = value.trim();
    if (!trimmed.startsWith("[") || !trimmed.endsWith("]"))
    {
        return undefined;
    }
    const inner = trimmed.slice(1, -1).trim();
    if (inner.length === 0)
    {
        return [];
    }
    const values: Array<string> = [];
    let current = "";
    let quote: string | undefined;
    let escaped = false;
    for (const character of inner)
    {
        if (quote !== undefined)
        {
            current += character;
            if (quote === "\"" && escaped)
            {
                escaped = false;
            }
            else if (quote === "\"" && character === "\\")
            {
                escaped = true;
            }
            else if (character === quote)
            {
                quote = undefined;
            }
        }
        else if (character === "\"" || character === "'")
        {
            quote = character;
            current += character;
        }
        else if (character === ",")
        {
            const parsed = parseTomlString(current);
            if (parsed === undefined)
            {
                return undefined;
            }
            values.push(parsed);
            current = "";
        }
        else
        {
            current += character;
        }
    }
    const last = current.trim();
    if (last.length > 0)
    {
        const parsed = parseTomlString(last);
        if (parsed === undefined)
        {
            return undefined;
        }
        values.push(parsed);
    }
    return values;
}

function extractPort(entry: unknown): number | undefined
{
    if (!isRecord(entry))
    {
        return undefined;
    }
    if (typeof entry.url === "string")
    {
        try
        {
            const parsed = new URL(entry.url);
            return parsed.port.length > 0 && /^\d+$/.test(parsed.port)
                ? Number(parsed.port)
                : undefined;
        }
        catch
        {
            return undefined;
        }
    }
    if (!Array.isArray(entry.args))
    {
        return undefined;
    }
    const args = entry.args;
    const index = args.findIndex((value) => value === "--port");
    if (index < 0 || typeof args[index + 1] !== "string" || !/^\d+$/.test(args[index + 1]))
    {
        return undefined;
    }
    return Number(args[index + 1]);
}

function readFileState(filePath: string): FileState
{
    try
    {
        const stat = fs.statSync(filePath);
        if (!stat.isFile())
        {
            return { exists: true, readable: false };
        }
        return { content: fs.readFileSync(filePath, "utf8"), exists: true, readable: true };
    }
    catch (error: unknown)
    {
        return (error as NodeJS.ErrnoException).code === "ENOENT"
            ? { exists: false, readable: true }
            : { exists: true, readable: false };
    }
}

function sameState(left: FileState, right: FileState): boolean
{
    return left.exists === right.exists
        && left.readable === right.readable
        && left.content === right.content;
}

function createBackup(filePath: string): string
{
    const backupPath = `${filePath}.backup-${Date.now()}`;
    let candidate = backupPath;
    let index = 1;
    while (exists(candidate))
    {
        candidate = `${backupPath}-${index++}`;
    }
    fs.copyFileSync(filePath, candidate);
    return candidate;
}

function exists(filePath: string): boolean
{
    try
    {
        fs.statSync(filePath);
        return true;
    }
    catch
    {
        return false;
    }
}

function isRecord(value: unknown): value is Record<string, unknown>
{
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepEqual(left: unknown, right: unknown): boolean
{
    if (Object.is(left, right))
    {
        return true;
    }
    if (Array.isArray(left) || Array.isArray(right))
    {
        return Array.isArray(left)
            && Array.isArray(right)
            && left.length === right.length
            && left.every((value, index) => deepEqual(value, right[index]));
    }
    if (isRecord(left) || isRecord(right))
    {
        if (!isRecord(left) || !isRecord(right))
        {
            return false;
        }
        const leftKeys = Object.keys(left).sort();
        const rightKeys = Object.keys(right).sort();
        return leftKeys.length === rightKeys.length
            && leftKeys.every((key, index) => key === rightKeys[index] && deepEqual(left[key], right[key]));
    }
    return false;
}

function normalizePath(value: string): string
{
    return path.resolve(value).toLowerCase();
}

function stripBom(value: string): string
{
    return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}
