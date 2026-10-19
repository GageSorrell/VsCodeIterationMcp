/**
 * @module vscode-iteration-mcp/Installation/SkillInstaller
 *
 * @file      SkillInstaller.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { AGENT_ADAPTERS, type AgentAdapter, type SupportedAgent } from "../Agents/AgentAdapters";
import type { InstallScope, ScopeContext } from "./ScopeService";
import { ActionableError } from "../Core/Errors";
import { randomUUID } from "node:crypto";
import { writeFileAtomicSync } from "../Runtime/FileUtils";

export type SkillInspectionStatus =
    | "installed"
    | "missing"
    | "modified"
    | "unreadable"
    | "unsupported";

export type SkillInstallStatus =
    | SkillInspectionStatus
    | "cancelled"
    | "error"
    | "skipped"
    | "unchanged"
    | "updated";

export interface SkillTarget
{
    agent: SupportedAgent;
    path?: string;
    scope: InstallScope;
    workspaceFolder?: string;
}

export interface SkillTargetResult
{
    agent: SupportedAgent;
    message?: string;
    path?: string;
    scope: InstallScope;
    status: SkillInstallStatus;
    workspaceFolder?: string;
}

export interface SkillInstallReport
{
    results: ReadonlyArray<SkillTargetResult>;
    scope: InstallScope;
    sourcePath: string;
    workspaceFolder?: string;
}

interface SkillFileState
{
    content?: string;
    exists: boolean;
    readable: boolean;
}

interface SkillTargetPlan
{
    snapshot: SkillFileState;
    target: SkillTarget;
    result: SkillTargetResult;
}

const SkillName = "vscode-iteration-mcp";
const SkillFileName = "SKILL.md";

/** Installs and inspects the bundled Agent Skill without silently overwriting files. */
export class SkillInstaller implements vscode.Disposable
{
    readonly sourcePath: string;

    constructor(private readonly context: vscode.ExtensionContext)
    {
        this.sourcePath = path.join(
            context.extensionPath,
            "resources",
            "skills",
            SkillName,
            SkillFileName
        );
    }

    inspect(scope: InstallScope, workspaceFolder?: vscode.WorkspaceFolder): ReadonlyArray<SkillTargetResult>
    {
        return this.targets(scope, workspaceFolder).map((target: SkillTarget) =>
        {
            if (target.path === undefined)
            {
                return {
                    agent: target.agent,
                    message: unsupportedMessage(target),
                    scope: target.scope,
                    status: "unsupported" as const,
                    ...(target.workspaceFolder === undefined
                        ? { }
                        : { workspaceFolder: target.workspaceFolder }
                    )
                };
            }
            const inspection = inspectFile(target.path, this.readBundleSafely());
            return {
                agent: target.agent,
                message: inspection.message,
                path: target.path,
                scope: target.scope,
                status: inspection.status,
                ...(target.workspaceFolder === undefined ? {} : { workspaceFolder: target.workspaceFolder })
            };
        });
    }

    inspectAll(): ReadonlyArray<SkillTargetResult>
    {
        const results: Array<SkillTargetResult> = [];
        for (const folder of vscode.workspace.workspaceFolders ?? [])
        {
            results.push(...this.inspect("project", folder));
        }
        results.push(...this.inspect("user"));
        results.push(...this.inspect("system"));
        return results;
    }

    async install(scopeContext: ScopeContext): Promise<SkillInstallReport>
    {
        const bundle = this.readBundle();
        this.validateScopeContext(scopeContext);
        const targets = this.targets(scopeContext.scope, scopeContext.workspaceFolder);
        if (scopeContext.scope === "system")
        {
            const destinations = targets.map((target: SkillTarget) =>
                target.path ?? `${displayAgent(target.agent)}: unsupported on native Windows`
            );
            const choice = await vscode.window.showWarningMessage(
                "System skill installation writes to the following machine-wide destinations: " +
                `${destinations.join("; ")}. Claude Code managed locations can affect which ` +
                "other scopes load. " +
                "Codex System remains unsupported until a native Windows destination is verified.",
                "Continue",
                "Cancel"
            );
            if (choice !== "Continue")
            {
                return {
                    results: targets.map((target: SkillTarget) => ({
                        agent: target.agent,
                        message: target.path === undefined
                            ? unsupportedMessage(target)
                            : "System installation cancelled before any files were changed.",
                        path: target.path,
                        scope: target.scope,
                        status: target.path === undefined
                            ? "unsupported" as const
                            : "cancelled" as const,
                        ...(target.workspaceFolder === undefined
                            ? { }
                            : { workspaceFolder: target.workspaceFolder })
                    })),
                    scope: scopeContext.scope,
                    sourcePath: this.sourcePath,
                    ...(scopeContext.workspaceFolder === undefined
                        ? {}
                        : { workspaceFolder: scopeContext.workspaceFolder.uri.fsPath })
                };
            }
        }
        const plans = targets.map((target: SkillTarget) => this.planTarget(target, bundle));

        for (const plan of plans)
        {
            if (plan.result.status !== "modified")
            {
                continue;
            }
            const choice = await vscode.window.showWarningMessage(
                `${displayAgent(plan.target.agent)} has a modified skill at ${plan.target.path}. ` +
                "Updating it will create a backup and replace its contents.",
                "Update",
                "Skip",
                "Cancel"
            );
            if (choice === "Cancel" || choice === undefined)
            {
                return {
                    results: plans.map((candidate: SkillTargetPlan) => candidate.result.status === "modified"
                        || candidate.result.status === "missing"
                        ? {
                            ...candidate.result,
                            message: "Installation cancelled before any files were changed.",
                            status: "cancelled" as const
                        }
                        : candidate.result),
                    scope: scopeContext.scope,
                    sourcePath: this.sourcePath,
                    ...(scopeContext.workspaceFolder === undefined
                        ? {}
                        : { workspaceFolder: scopeContext.workspaceFolder.uri.fsPath })
                };
            }
            if (choice === "Skip")
            {
                plan.result = { ...plan.result, status: "skipped" };
            }
        }

        this.validateScopeContext(scopeContext);
        for (const plan of plans)
        {
            if (plan.target.path === undefined || plan.result.status === "unsupported"
                || plan.result.status === "unreadable" || plan.result.status === "skipped"
                || plan.result.status === "cancelled" || plan.result.status === "installed"
                || plan.result.status === "unchanged")
            {
                continue;
            }
            if (plan.result.status !== "missing" && plan.result.status !== "modified")
            {
                continue;
            }
            const current = readFileState(plan.target.path);
            if (!sameFileState(current, plan.snapshot))
            {
                plan.result = {
                    ...plan.result,
                    message: "The target changed while installation choices " +
                    "were open; it was not overwritten.",
                    status: "error"
                };
                continue;
            }
            try
            {
                if (plan.snapshot.exists)
                {
                    const backupPath = createBackup(plan.target.path);
                    writeFileAtomicSync(plan.target.path, bundle, 0o600);
                    plan.result = {
                        ...plan.result,
                        message: `Backup created at ${backupPath}.`,
                        status: "updated"
                    };
                }
                else
                {
                    writeFileAtomicSync(plan.target.path, bundle, 0o600);
                    plan.result = { ...plan.result, status: "installed" };
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
            results: plans.map((plan: SkillTargetPlan) => plan.result),
            scope: scopeContext.scope,
            sourcePath: this.sourcePath,
            ...(scopeContext.workspaceFolder === undefined
                ? {}
                : { workspaceFolder: scopeContext.workspaceFolder.uri.fsPath })
        };
    }

    dispose(): void
    {
        // The installer owns no long-lived resources.
    }

    private planTarget(target: SkillTarget, bundle: string): SkillTargetPlan
    {
        if (target.path === undefined)
        {
            return {
                result: {
                    agent: target.agent,
                    message: unsupportedMessage(target),
                    scope: target.scope,
                    status: "unsupported",
                    ...(target.workspaceFolder === undefined
                        ? { }
                        : { workspaceFolder: target.workspaceFolder })
                },
                snapshot: { exists: false, readable: false },
                target
            };
        }
        const snapshot = readFileState(target.path);
        const inspection = inspectFileState(snapshot, bundle);
        return {
            result: {
                agent: target.agent,
                message: inspection.message,
                path: target.path,
                scope: target.scope,
                status: inspection.status === "installed" ? "unchanged" : inspection.status,
                ...(target.workspaceFolder === undefined ? {} : { workspaceFolder: target.workspaceFolder })
            },
            snapshot,
            target
        };
    }

    private targets(scope: InstallScope, workspaceFolder?: vscode.WorkspaceFolder): Array<SkillTarget>
    {
        const workspacePath = workspaceFolder?.uri.scheme === "file"
            ? workspaceFolder.uri.fsPath
            : undefined;
        return AGENT_ADAPTERS.map(({ id }: AgentAdapter) => ({
            agent: id,
            path: skillPath(id, scope, workspacePath),
            scope,
            ...(workspacePath === undefined ? {} : { workspaceFolder: workspacePath })
        }));
    }

    private readBundle(): string
    {
        let content: string;
        try
        {
            content = fs.readFileSync(this.sourcePath, "utf8");
        }
        catch (error: unknown)
        {
            throw new ActionableError({
                action: "Reinstall the extension so its bundled resources are present.",
                code: "NOT_READY",
                message: `Could not read the bundled skill at ${this.sourcePath}: ` +
                `${error instanceof Error ? error.message : String(error)}`
            });
        }
        validateSkillContent(content, this.sourcePath);
        return content;
    }

    private readBundleSafely(): string | undefined
    {
        try
        {
            return this.readBundle();
        }
        catch
        {
            return undefined;
        }
    }

    private validateScopeContext(scopeContext: ScopeContext): void
    {
        if (scopeContext.scope !== "project")
        {
            return;
        }
        const folder = scopeContext.workspaceFolder;
        const current = vscode.workspace.workspaceFolders?.find((candidate: vscode.WorkspaceFolder) =>
            candidate.uri.scheme === folder?.uri.scheme && candidate.uri.fsPath === folder?.uri.fsPath
        );
        if (!folder || !current || folder.uri.scheme !== "file")
        {
            throw new ActionableError({
                action: "Restart the skill installation and choose an open local workspace root.",
                code: "NOT_READY",
                message: "The selected Project workspace root is no longer available."
            });
        }
    }
}

export function validateSkillContent(content: string, sourcePath: string = SkillFileName): void
{
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
    if (!match)
    {
        throw new ActionableError({
            action: "Restore the bundled skill frontmatter and retry.",
            code: "INVALID_ARGUMENT",
            message: `Skill '${sourcePath}' is missing portable YAML frontmatter.`
        });
    }
    const name = /^name:\s*(\S.*?)\s*$/m.exec(match[1])?.[1];
    const description = /^description:\s*(\S.*?)\s*$/m.exec(match[1])?.[1];
    if (name !== SkillName || description === undefined || description.length === 0)
    {
        throw new ActionableError({
            action: "Provide a non-empty name and description for the bundled skill.",
            code: "INVALID_ARGUMENT",
            message: `Skill '${sourcePath}' has invalid frontmatter; expected name '${SkillName}'.`
        });
    }
}

export function skillPath(
    agent: SupportedAgent,
    scope: InstallScope,
    workspacePath?: string,
    homeDirectory: string = resolveHomeDirectory()
): string | undefined
{
    if (scope === "project")
    {
        if (workspacePath === undefined)
        {
            return undefined;
        }
        return path.join(
            workspacePath,
            agent === "claude-code" ? ".claude" : ".agents",
            "skills",
            SkillName,
            SkillFileName
        );
    }
    if (scope === "user")
    {
        return path.join(
            homeDirectory,
            agent === "claude-code" ? ".claude" : ".agents",
            "skills",
            SkillName,
            SkillFileName
        );
    }
    if (agent === "codex" || process.platform !== "win32")
    {
        return undefined;
    }
    return path.join(
        process.env.ProgramFiles ?? "C:\\Program Files",
        "ClaudeCode",
        ".claude",
        "skills",
        SkillName,
        SkillFileName
    );
}

export function resolveHomeDirectory(env: NodeJS.ProcessEnv = process.env): string
{
    return env.VSCODE_ITERATION_MCP_SKILL_HOME
        ?? env.USERPROFILE
        ?? env.HOME
        ?? os.homedir();
}

function inspectFile(
    filePath: string,
    bundle: string | undefined
): {
    message?: string;
    status: SkillInspectionStatus;
}
{
    if (bundle === undefined)
    {
        return { message: "The bundled skill could not be validated.", status: "unreadable" };
    }
    return inspectFileState(readFileState(filePath), bundle);
}

function inspectFileState(
    state: SkillFileState,
    bundle: string
): {
    message?: string;
    status: SkillInspectionStatus;
}
{
    if (!state.exists)
    {
        return { status: "missing" };
    }
    if (!state.readable || state.content === undefined)
    {
        return { message: "The existing skill file could not be read.", status: "unreadable" };
    }
    if (state.content === bundle)
    {
        return { status: "installed" };
    }
    return {
        message: "The existing file differs from the bundled skill and may contain user modifications.",
        status: "modified"
    };
}

function readFileState(filePath: string): SkillFileState
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
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
        {
            return { exists: false, readable: true };
        }
        return { exists: true, readable: false };
    }
}

function sameFileState(left: SkillFileState, right: SkillFileState): boolean
{
    return left.exists === right.exists
        && left.readable === right.readable
        && left.content === right.content;
}

function createBackup(filePath: string): string
{
    const backupPath = `${filePath}.backup-${Date.now()}-${randomUUID().slice(0, 8)}`;
    fs.copyFileSync(filePath, backupPath);
    return backupPath;
}

function displayAgent(agent: SupportedAgent): string
{
    return AGENT_ADAPTERS.find((candidate: AgentAdapter) => candidate.id === agent)?.displayName ?? agent;
}

function unsupportedMessage(target: SkillTarget): string
{
    if (target.scope === "system" && target.agent === "codex")
    {
        return "Codex System skill discovery has no verified native Windows destination.";
    }
    if (target.scope === "project")
    {
        return "Project skill installation requires an open local file workspace root.";
    }
    return "This skill destination is unsupported in the current environment.";
}
