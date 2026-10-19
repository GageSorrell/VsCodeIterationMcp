/**
 * @module vscode-iteration-mcp/Sidebar/SidebarProvider
 *
 * @file      SidebarProvider.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

import { randomUUID } from "node:crypto";
import type * as vscode from "vscode";
import type { AgentConfigInspection, ProjectPortMismatch } from "../Agents/AgentConfig";
import type { ServerStatus } from "../Mcp/ServerController";
import type { SkillTargetResult } from "../Installation/SkillInstaller";

export interface SidebarState
{
    agents: ReadonlyArray<AgentConfigInspection>;
    mismatches: ReadonlyArray<ProjectPortMismatch>;
    server: ServerStatus;
    skills: ReadonlyArray<SkillTargetResult>;
}

export type SidebarCommand =
    | "vscodeIterationMcp.addProjectWorkspaceSettings"
    | "vscodeIterationMcp.addToAgents"
    | "vscodeIterationMcp.installSkill"
    | "vscodeIterationMcp.openPortSettings"
    | "vscodeIterationMcp.resetPortOverride"
    | "vscodeIterationMcp.restartServer"
    | "vscodeIterationMcp.startServer"
    | "vscodeIterationMcp.stopServer";

export type SidebarMessage =
    | { type: "command"; command: SidebarCommand }
    | { type: "refresh" }
    | { type: "setPortOverride"; value: string };

export type SidebarMessageHandler = (message: SidebarMessage) => Promise<void> | void;

/** Hosts the live setup UI and validates every message before it reaches the extension host. */
export class SidebarProvider implements vscode.WebviewViewProvider, vscode.Disposable
{
    private readonly disposables: Array<vscode.Disposable> = [];

    private view: vscode.WebviewView | undefined;

    constructor(
        private readonly getState: () => SidebarState,
        private readonly handleMessage: SidebarMessageHandler
    )
    {
    }

    resolveWebviewView(webviewView: vscode.WebviewView): void
    {
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: []
        };
        webviewView.webview.html = renderHtml(this.getState());
        this.disposables.push(
            webviewView.webview.onDidReceiveMessage((message: unknown) =>
            {
                const parsed = parseSidebarMessage(message);
                if (parsed !== undefined)
                {
                    void Promise.resolve(this.handleMessage(parsed)).catch(() =>
                    {
                        // Command handlers report actionable errors through VS Code UI.
                    });
                }
            }),
            webviewView.onDidDispose(() =>
            {
                if (this.view === webviewView)
                {
                    this.view = undefined;
                }
            })
        );
    }

    refresh(): void
    {
        const view = this.view;
        if (view === undefined)
        {
            return;
        }
        void view.webview.postMessage({ type: "state", state: this.getState() });
    }

    dispose(): void
    {
        for (const disposable of this.disposables.splice(0))
        {
            disposable.dispose();
        }
        this.view = undefined;
    }
}

const AllowedCommands = new Set<SidebarCommand>([
    "vscodeIterationMcp.addProjectWorkspaceSettings",
    "vscodeIterationMcp.addToAgents",
    "vscodeIterationMcp.installSkill",
    "vscodeIterationMcp.openPortSettings",
    "vscodeIterationMcp.resetPortOverride",
    "vscodeIterationMcp.restartServer",
    "vscodeIterationMcp.startServer",
    "vscodeIterationMcp.stopServer"
]);

function parseSidebarMessage(value: unknown): SidebarMessage | undefined
{
    if (value === null || typeof value !== "object")
    {
        return undefined;
    }
    const message = value as Record<string, unknown>;
    if (message.type === "refresh")
    {
        return { type: "refresh" };
    }
    if (message.type === "setPortOverride" && typeof message.value === "string" && message.value.length <= 32)
    {
        return { type: "setPortOverride", value: message.value };
    }
    if (message.type === "command" && typeof message.command === "string"
        && AllowedCommands.has(message.command as SidebarCommand))
    {
        return { command: message.command as SidebarCommand, type: "command" };
    }
    return undefined;
}

function renderHtml(state: SidebarState): string
{
    const nonce = randomUUID().replace(/-/g, "");
    const initialState = JSON.stringify(state).replace(/</g, "\\u003c");
    const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>VS Code Iteration MCP</title>
<style>
:root { color-scheme: light dark; }
body { color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); padding: 0 10px 16px; margin: 0; }
main { display: flex; flex-direction: column; gap: 12px; }
section { border-top: 1px solid var(--vscode-panel-border); padding-top: 10px; }
h1, h2, h3 { margin: 0 0 8px; font-weight: 600; }
h1 { font-size: 1.15em; } h2 { font-size: 1.05em; } h3 { font-size: 1em; }
p { margin: 5px 0; } .muted { color: var(--vscode-descriptionForeground); }
.error { color: var(--vscode-errorForeground); } .warning { color: var(--vscode-editorWarning-foreground); }
.status { font-weight: 600; text-transform: capitalize; }
.facts { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 4px 10px; margin: 8px 0; }
.facts dt { color: var(--vscode-descriptionForeground); } .facts dd { margin: 0; overflow-wrap: anywhere; }
.actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
button { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 0; border-radius: 2px; padding: 5px 9px; cursor: pointer; }
button:hover { background: var(--vscode-button-hoverBackground); }
button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
button:focus-visible, input:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
label { display: block; margin-bottom: 4px; }
input { box-sizing: border-box; width: 100%; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); padding: 5px; }
.item { border-left: 2px solid var(--vscode-textLink-foreground); padding: 4px 0 4px 8px; margin: 6px 0; }
.item strong { display: inline-block; margin-right: 5px; } code { font-family: var(--vscode-editor-font-family); font-size: .9em; overflow-wrap: anywhere; }
</style>
</head>
<body>
<main id="app" aria-live="polite"></Main>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
let state = ${initialState};
const allowedCommands = new Set(${JSON.stringify([ ...AllowedCommands ])});
function esc(value) { return String(value ?? '').replace(/[&<>\"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' }[character])); }
function sendCommand(command) { if (allowedCommands.has(command)) vscode.postMessage({ type: 'command', command }); }
function scopeLabel(item) { return item.scope + (item.workspaceFolder ? ' — ' + item.workspaceFolder : ''); }
function renderItems(items, emptyText) {
  if (!items.length) return '<p class="muted">' + esc(emptyText) + '</p>';
  return items.map((item) => {
    const policy = item.effective === false ? '<span class="warning">Policy may prevent activation.</span>' : '';
    const message = item.message ? '<p class="muted">' + esc(item.message) + '</p>' : '';
    const target = item.path ? '<p class="muted"><code>' + esc(item.path) + '</code></p>' : '';
    return '<div class="item"><strong>' + esc(item.agent) + '</strong><span class="status">' + esc(item.status) + '</span>' + '<p class="muted">' + esc(scopeLabel(item)) + '</p>' + policy + message + target + '</div>';
  }).join('');
}
function render() {
  const server = state.server || {}, port = server.port || {}, override = port.overridePort === undefined ? 'None' : String(port.overridePort), requested = server.requestedPort === undefined ? port.requestedPort : server.requestedPort, actual = server.actualPort === undefined ? 'Not bound' : String(server.actualPort);
  const stateMessage = server.message ? '<p class="error">' + esc(server.message) + '</p>' : '', configurationError = server.configurationError ? '<p class="error">' + esc(server.configurationError) + '</p>' : '';
  const mismatchBlock = state.mismatches.length ? '<div class="item"><strong>Workspace settings suggestions</strong><p>' + esc(state.mismatches.length + ' project mismatch' + (state.mismatches.length === 1 ? '' : 'es') + ' detected.') + '</p>' + state.mismatches.map((item) => '<p class="muted">' + esc(item.agent + ' — ' + item.root + ' (configured ' + item.configuredPort + ', workspace ' + item.workspacePort + ')') + '</p>').join('') + '<div class="actions"><button data-command="vscodeIterationMcp.addProjectWorkspaceSettings">Use Workspace Settings at Project Scope</button></div></div>' : '';
  document.getElementById('app').innerHTML = '<h1>VS Code Iteration MCP</h1>' +
    '<section aria-labelledby="server-heading"><h2 id="server-heading">MCP Server</h2><p class="status">' + esc(server.state || 'unknown') + '</p>' + stateMessage + configurationError +
    '<dl class="facts"><dt>Settings</dt><dd>' + esc(port.settingPort === undefined ? 'Unavailable' : port.settingPort) + '</dd><dt>Override</dt><dd>' + esc(override) + '</dd><dt>Requested</dt><dd>' + esc(requested === undefined ? 'Unavailable' : requested) + '</dd><dt>Actual</dt><dd>' + esc(actual) + '</dd><dt>Endpoint</dt><dd>' + esc(server.endpoint || 'Unavailable') + '</dd></dl>' +
    '<form id="port-form"><label for="port-input">Workspace port override</label><input id="port-input" name="port" type="text" inputmode="numeric" autocomplete="off" placeholder="Blank removes override" value="' + esc(port.overridePort === undefined ? '' : port.overridePort) + '"><div class="actions"><button type="submit">Apply</button><button type="button" class="secondary" data-command="vscodeIterationMcp.resetPortOverride">Reset</button><button type="button" class="secondary" data-command="vscodeIterationMcp.openPortSettings">Open Settings</button></div></form>' +
    '<div class="actions"><button type="button" class="secondary" data-command="vscodeIterationMcp.refresh">Refresh</button>' + (server.state === 'running' ? '<button type="button" class="secondary" data-command="vscodeIterationMcp.restartServer">Restart</button><button type="button" class="secondary" data-command="vscodeIterationMcp.stopServer">Stop</button>' : '<button type="button" data-command="vscodeIterationMcp.startServer">Start</button>') + '</div></section>' +
    '<section aria-labelledby="agents-heading"><h2 id="agents-heading">Agents</h2>' + renderItems(state.agents || [], 'No agent configuration files detected.') + mismatchBlock + '<div class="actions"><button type="button" data-command="vscodeIterationMcp.addToAgents">Add MCP Server to Agents...</button></div></section>' +
    '<section aria-labelledby="skill-heading"><h2 id="skill-heading">Skill</h2>' + renderItems(state.skills || [], 'No skill installation status available.') + '<div class="actions"><button type="button" data-command="vscodeIterationMcp.installSkill">Install / Update Skill...</button></div></section>';
  document.querySelectorAll('[data-command]').forEach((button) => { button.addEventListener('click', () => { const command = button.getAttribute('data-command'); if (command === 'vscodeIterationMcp.refresh') vscode.postMessage({ type: 'refresh' }); else if (allowedCommands.has(command)) sendCommand(command); }); });
  document.getElementById('port-form').addEventListener('submit', (event) => { event.preventDefault(); vscode.postMessage({ type: 'setPortOverride', value: document.getElementById('port-input').value }); });
}
window.addEventListener('message', (event) => { if (event.data && event.data.type === 'state' && event.data.state) { state = event.data.state; render(); } });
render();
</script>
</body>
</html>`;
}
