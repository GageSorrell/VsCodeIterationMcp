/**
 * @module vscode-iteration-mcp/Agents/AgentAdapters
 *
 * @file      AgentAdapters.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

export type SupportedAgent = "claude-code" | "codex";

export interface AgentAdapter {
    readonly id: SupportedAgent;
    readonly displayName: string;
}

export const AGENT_ADAPTERS: ReadonlyArray<AgentAdapter> = [
    { id: "claude-code", displayName: "Claude Code" },
    { id: "codex", displayName: "Codex" }
];
