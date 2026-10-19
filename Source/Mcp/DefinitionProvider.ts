/**
 * @module vscode-iteration-mcp/Mcp/DefinitionProvider
 *
 * @file      DefinitionProvider.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

import * as vscode from "vscode";
import type { TransportConnection } from "./Transport";

export const McpDefinitionProviderId = "vscodeIterationMcp.server";
const DefinitionLabel = "VS Code Iteration MCP";

/** Advertises this window's live HTTP endpoint to VS Code's own MCP client. */
export class McpDefinitionProvider
implements vscode.McpServerDefinitionProvider<vscode.McpHttpServerDefinition>, vscode.Disposable
{
    private readonly changed: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    readonly onDidChangeMcpServerDefinitions: vscode.Event<void> = this.changed.event;

    constructor(
        private readonly getConnection: () => TransportConnection | undefined,
        private readonly version: string
    ) {}

    /** Signals VS Code to re-query after start, stop, or a port change. */
    refresh(): void
    {
        this.changed.fire();
    }

    provideMcpServerDefinitions(): Array<vscode.McpHttpServerDefinition>
    {
        const connection = this.getConnection();
        return connection ? [ this.toDefinition(connection) ] : [];
    }

    resolveMcpServerDefinition(definition: vscode.McpHttpServerDefinition): vscode.McpHttpServerDefinition
    {
        const connection = this.getConnection();
        if (!connection)
        {
            throw new Error(
                "The VS Code Iteration MCP server is not running in this window. Run \"VS Code Iteration " +
                "MCP: Start Server\"."
            );
        }
        // The listener may have restarted since the definition was provided.
        definition.uri = vscode.Uri.parse(connection.endpoint);
        definition.headers = { Authorization: `Bearer ${connection.token}` };
        return definition;
    }

    dispose(): void
    {
        this.changed.dispose();
    }

    private toDefinition(connection: TransportConnection): vscode.McpHttpServerDefinition
    {
        return new vscode.McpHttpServerDefinition(
            DefinitionLabel,
            vscode.Uri.parse(connection.endpoint),
            { Authorization: `Bearer ${connection.token}` },
            this.version
        );
    }
}
