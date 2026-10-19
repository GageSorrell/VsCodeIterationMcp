/**
 * @module vscode-iteration-mcp/Lifecycle/WorkspaceTrust
 *
 * @file      WorkspaceTrust.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

/** Workspace trust is an activation gate: untrusted workspaces never start a listener. */
export function shouldStartServer(workspaceIsTrusted: boolean): boolean
{
    return workspaceIsTrusted;
}
