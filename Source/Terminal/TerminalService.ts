/**
 * @module vscode-iteration-mcp/Terminal/TerminalService
 *
 * @file      TerminalService.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import { executeBuiltInCommand } from "../Commands/CommandCompatibility";
import { ActionableError } from "../Core/Errors";

export interface TerminalSession
{
    active: boolean;
    id: string;
    name: string;
}

export interface TerminalProfile
{
    isDefault: boolean;
    name: string;
}

export interface TerminalProfiles
{
    complete: false;
    defaultProfile?: string;
    profiles: ReadonlyArray<TerminalProfile>;
}

export interface TerminalCreateResult extends TerminalSession
{
    created: true;
    profileName?: string;
}

export interface TerminalSendResult
{
    name: string;
    pressEnter: boolean;
    terminalId: string;
    textLength: number;
}

export interface TerminalReadResult
{
    lineCount: number;
    name: string;
    terminalId: string;
    text: string;
}

/** Owns extension-lifetime terminal identity and serializes terminal mutations. */
export class TerminalService implements vscode.Disposable
{
    private readonly ids = new Map<vscode.Terminal, string>();

    private readonly subscriptions: Array<vscode.Disposable> = [];

    private operation: Promise<unknown> = Promise.resolve();

    constructor()
    {
        for (const terminal of vscode.window.terminals)
        {
            this.register(terminal);
        }
        this.subscriptions.push(
            vscode.window.onDidOpenTerminal((terminal) => this.register(terminal)),
            vscode.window.onDidCloseTerminal((terminal) => this.ids.delete(terminal))
        );
    }

    list(): ReadonlyArray<TerminalSession>
    {
        return vscode.window.terminals.map((terminal) => this.describe(terminal));
    }

    async focus(terminalId?: string): Promise<TerminalSession>
    {
        return this.enqueue(async () =>
        {
            const terminal = terminalId === undefined
                ? this.requireActiveTerminal()
                : this.requireTerminal(terminalId);
            terminal.show(false);
            await this.waitForActiveTerminal(terminal);
            return this.describe(terminal);
        });
    }

    listProfiles(): TerminalProfiles
    {
        const configuration = vscode.workspace.getConfiguration("terminal.integrated");
        const configured = configuration.get<unknown>("profiles.windows", {});
        const defaultValue = configuration.get<unknown>("defaultProfile.windows");
        const defaultProfile = typeof defaultValue === "string" && defaultValue.trim().length > 0
            ? defaultValue
            : undefined;
        const names = new Set<string>();
        if (isRecord(configured))
        {
            for (const name of Object.keys(configured))
            {
                names.add(name);
            }
        }
        if (defaultProfile)
        {
            names.add(defaultProfile);
        }
        return {
            complete: false,
            defaultProfile,
            profiles: [ ...names ].sort((left, right) => left.localeCompare(right)).map((name) => ({
                isDefault: name === defaultProfile,
                name
            }))
        };
    }

    async create(profileName?: string): Promise<TerminalCreateResult>
    {
        return this.enqueue(async () =>
        {
            if (profileName !== undefined)
            {
                const profiles = this.listProfiles();
                if (!profiles.profiles.some((profile) => profile.name === profileName))
                {
                    throw new ActionableError({
                        action: "Call terminal_list_profiles and use a configured profile name.",
                        code: "NOT_FOUND",
                        message: `Configured terminal profile '${profileName}' was not found.`
                    });
                }
            }

            const before = new Set(vscode.window.terminals);
            if (profileName === undefined)
            {
                await executeBuiltInCommand("workbench.action.terminal.new");
            }
            else
            {
                await executeBuiltInCommand(
                    "workbench.action.terminal.newWithProfile",
                    { location: "view", profileName }
                );
            }
            const terminal = await this.waitForNewTerminal(before);
            terminal.show(false);
            await this.waitForActiveTerminal(terminal);
            return {
                ...this.describe(terminal),
                created: true as const,
                ...(profileName === undefined ? {} : { profileName })
            };
        });
    }

    async sendText(text: string, pressEnter: boolean = false): Promise<TerminalSendResult>
    {
        return this.enqueue(async () =>
        {
            const terminal = this.requireActiveTerminal();
            const terminalId = this.register(terminal);
            terminal.sendText(text, pressEnter);
            return {
                name: terminal.name,
                pressEnter,
                terminalId,
                textLength: text.length
            };
        });
    }

    async read(maxLines?: number): Promise<TerminalReadResult>
    {
        return this.enqueue(async () =>
        {
            const terminal = this.requireActiveTerminal();
            const terminalId = this.register(terminal);
            terminal.show(false);
            await this.waitForActiveTerminal(terminal);
            this.assertActiveTerminal(terminal);

            const originalClipboard = await vscode.env.clipboard.readText();
            this.assertActiveTerminal(terminal);
            const clipboardSentinel = `vscode-iteration-mcp-terminal-read-${randomUUID()}`;
            await vscode.env.clipboard.writeText(clipboardSentinel);
            this.assertActiveTerminal(terminal);
            let copiedClipboardValue: string | undefined = clipboardSentinel;
            try
            {
                await executeBuiltInCommand("workbench.action.terminal.selectAll");
                this.assertActiveTerminal(terminal);
                await executeBuiltInCommand("workbench.action.terminal.copySelection");
                this.assertActiveTerminal(terminal);
                copiedClipboardValue = await this.waitForCopiedClipboard(clipboardSentinel);
                this.assertActiveTerminal(terminal);
                const copiedText = copiedClipboardValue === clipboardSentinel
                    ? ""
                    : copiedClipboardValue;
                const limited = limitLines(normalizeLineEndings(copiedText), maxLines);
                return {
                    lineCount: limited.lineCount,
                    name: terminal.name,
                    terminalId,
                    text: limited.text
                };
            }
            finally
            {
                await this.cleanupRead(terminal, copiedClipboardValue, originalClipboard);
                this.assertActiveTerminal(terminal);
            }
        });
    }

    dispose(): void
    {
        for (const subscription of this.subscriptions)
        {
            subscription.dispose();
        }
        this.subscriptions.length = 0;
        this.ids.clear();
    }

    private describe(terminal: vscode.Terminal): TerminalSession
    {
        return {
            active: vscode.window.activeTerminal === terminal,
            id: this.register(terminal),
            name: terminal.name
        };
    }

    private register(terminal: vscode.Terminal): string
    {
        const existing = this.ids.get(terminal);
        if (existing)
        {
            return existing;
        }
        const id = `terminal-${randomUUID()}`;
        this.ids.set(terminal, id);
        return id;
    }

    private requireActiveTerminal(): vscode.Terminal
    {
        const terminal = vscode.window.activeTerminal;
        if (!terminal || !vscode.window.terminals.includes(terminal))
        {
            throw new ActionableError({
                action: "Create or focus an existing terminal before sending input.",
                code: "NOT_READY",
                message: "There is no active terminal."
            });
        }
        return terminal;
    }

    private requireTerminal(terminalId: string): vscode.Terminal
    {
        for (const [ terminal, id ] of this.ids)
        {
            if (id === terminalId)
            {
                if (vscode.window.terminals.includes(terminal))
                {
                    return terminal;
                }
                this.ids.delete(terminal);
                break;
            }
        }
        throw new ActionableError({
            action: "Call terminal_list and use an ID for an open terminal.",
            code: "NOT_FOUND",
            message: `Terminal session '${terminalId}' was not found or is closed.`
        });
    }

    private assertActiveTerminal(terminal: vscode.Terminal): void
    {
        if (vscode.window.activeTerminal !== terminal || !vscode.window.terminals.includes(terminal))
        {
            throw new ActionableError({
                action: "Keep the requested terminal focused and retry the read.",
                code: "NOT_READY",
                message: "The active terminal changed while reading terminal scrollback."
            });
        }
    }

    private async waitForCopiedClipboard(sentinel: string): Promise<string>
    {
        const deadline = Date.now() + 500;
        for (;;)
        {
            const value = await vscode.env.clipboard.readText();
            if (value !== sentinel || Date.now() >= deadline)
            {
                return value;
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
    }

    private async cleanupRead(
        terminal: vscode.Terminal,
        copiedClipboardValue: string | undefined,
        originalClipboard: string
    ): Promise<void>
    {
        if (copiedClipboardValue === undefined)
        {
            return;
        }
        if (vscode.window.activeTerminal === terminal && vscode.window.terminals.includes(terminal))
        {
            try
            {
                await executeBuiltInCommand("workbench.action.terminal.clearSelection");
            }
            catch
            {
                // Clipboard restoration is still safe to attempt if selection clearing is unavailable.
            }
        }
        try
        {
            if (await vscode.env.clipboard.readText() === copiedClipboardValue)
            {
                await vscode.env.clipboard.writeText(originalClipboard);
            }
        }
        catch
        {
            // Clipboard and selection cleanup are best effort and must not hide the read result/error.
        }
    }

    private async waitForNewTerminal(before: ReadonlySet<vscode.Terminal>): Promise<vscode.Terminal>
    {
        const deadline = Date.now() + 10_000;
        for (;;)
        {
            const terminal = vscode.window.terminals.find((candidate) => !before.has(candidate));
            if (terminal)
            {
                this.register(terminal);
                return terminal;
            }
            if (Date.now() >= deadline)
            {
                throw new ActionableError({
                    action: "Check the VS Code terminal panel and retry.",
                    code: "NOT_READY",
                    message: "VS Code did not expose the newly created terminal."
                });
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
    }

    private async waitForActiveTerminal(terminal: vscode.Terminal): Promise<void>
    {
        const deadline = Date.now() + 2_000;
        while (vscode.window.activeTerminal !== terminal)
        {
            if (Date.now() >= deadline)
            {
                throw new ActionableError({
                    action: "Check the VS Code terminal panel and retry.",
                    code: "NOT_READY",
                    message: `VS Code did not focus terminal '${terminal.name}'.`
                });
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
    }

    private enqueue<A>(operation: () => Promise<A>): Promise<A>
    {
        const result = this.operation.then(operation, operation);
        this.operation = result.then(() => undefined, () => undefined);
        return result;
    }
}

function isRecord(value: unknown): value is Record<string, unknown>
{
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeLineEndings(value: string): string
{
    return value.replace(/\r\n?/g, "\n");
}

function limitLines(text: string, maxLines: number | undefined): { lineCount: number; text: string }
{
    if (text.length === 0)
    {
        return { lineCount: 0, text: "" };
    }

    const hasTrailingNewline = text.endsWith("\n");
    const lines = text.split("\n");
    if (hasTrailingNewline)
    {
        lines.pop();
    }
    const lineCount = lines.length;
    if (maxLines === undefined || maxLines >= lineCount)
    {
        return { lineCount, text };
    }
    const selected = lines.slice(-maxLines);
    return {
        lineCount: selected.length,
        text: `${selected.join("\n")}${hasTrailingNewline ? "\n" : ""}`
    };
}
