/**
 * @module vscode-iteration-mcp/Mcp/Transport
 *
 * @file      Transport.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

import { McpHttpServer } from "./HttpServer";
import type { ToolDefinition } from "../Core/Validation";
import { asActionableError } from "../Core/Errors";
import { generateToken } from "./Auth";

export type TransportState =
    | "stopped"
    | "starting"
    | "running"
    | "error";

export interface TransportStatus
{
    state: TransportState;
    requestedPort: number;
    actualPort?: number;
    endpoint?: string;
    message?: string;
}

/** Live credentials for the running listener; never persisted to agent configuration. */
export interface TransportConnection
{
    endpoint: string;
    port: number;
    requestedPort: number;
    token: string;
}

export interface TransportHostOptions
{
    token?: string;
    tools?: ReadonlyArray<ToolDefinition>;
    log?: (message: string) => void;
}

/**
 * Owns this window's HTTP listener and bearer token. Lifecycle operations are serialized so
 * a restart always releases the old listener before binding the new one.
 */
export class McpTransportHost
{
    readonly token: string;
    private server: McpHttpServer | undefined;
    private status: TransportStatus = { requestedPort: 0, state: "stopped" };
    private queue: Promise<unknown> = Promise.resolve();
    private readonly listeners: Set<(status: TransportStatus) => void> =
        new Set<(status: TransportStatus) => void>();

    constructor(private readonly options: TransportHostOptions = {})
    {
        this.token = options.token ?? generateToken();
    }

    /** Starts (or restarts) on the requested port. Failures are reported in the status, not thrown. */
    start(requestedPort: number): Promise<TransportStatus>
    {
        return this.enqueue(async () =>
        {
            await this.closeServer();
            this.setStatus({ requestedPort, state: "starting" });
            const server = new McpHttpServer({
                log: this.options.log,
                requestedPort,
                token: this.token,
                tools: this.options.tools
            });
            try
            {
                const actualPort = await server.listen();
                this.server = server;
                this.setStatus({
                    actualPort,
                    endpoint: server.endpoint,
                    requestedPort,
                    state: "running"
                });
            }
            catch (error: unknown)
            {
                const details = asActionableError(error);
                this.setStatus({
                    message: details.action
                        ? `${details.message} ${details.action}`
                        : details.message,
                    requestedPort,
                    state: "error"
                });
            }
            return this.getStatus();
        });
    }

    stop(): Promise<void>
    {
        return this.enqueue(async () =>
        {
            await this.closeServer();
            this.setStatus({
                requestedPort: this.status.requestedPort,
                state: "stopped"
            });
        });
    }

    getStatus(): TransportStatus
    {
        return { ...this.status };
    }

    getConnection(): TransportConnection | undefined
    {
        if (this.status.state !== "running" || !this.server)
        {
            return undefined;
        }
        return {
            endpoint: this.server.endpoint,
            port: this.server.port,
            requestedPort: this.status.requestedPort,
            token: this.token
        };
    }

    onDidChangeStatus(listener: (status: TransportStatus) => void): { dispose(): void }
    {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
    }

    private async closeServer(): Promise<void>
    {
        const server = this.server;
        this.server = undefined;
        await server?.close();
    }

    private setStatus(status: TransportStatus): void
    {
        this.status = status;
        for (const listener of [ ...this.listeners ])
        {
            listener(this.getStatus());
        }
    }

    private enqueue<A>(operation: () => Promise<A>): Promise<A>
    {
        const result = this.queue.then(operation, operation);
        this.queue = result.catch(() => undefined);
        return result;
    }
}
