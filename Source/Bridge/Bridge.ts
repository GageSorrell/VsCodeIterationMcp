/**
 * @module vscode-iteration-mcp/Bridge/Bridge
 *
 * @file      Bridge.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

import {
    type JSONRPCMessage,
    type JSONRPCRequest,
    type RequestId,
    isJSONRPCErrorResponse,
    isJSONRPCRequest,
    isJSONRPCResultResponse
} from "@modelcontextprotocol/sdk/types.js";
import type { Readable, Writable } from "node:stream";
import type { RuntimeRecord, RuntimeRegistry } from "../Runtime/Registry";
import {
    StreamableHTTPClientTransport,
    StreamableHTTPError
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ActionableError } from "../Core/Errors";
import { Result } from "effect";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { selectWindow } from "./Discovery";

export interface BridgeOptions
{
    workspace: string;
    requestedPort: number;
    connectTimeoutMs: number;
    registry: RuntimeRegistry;
    input?: Readable;
    output?: Writable;
    log?: (message: string) => void;
    pollIntervalMs?: number;
}

/** Methods that are safe to resend even if the first attempt might have reached the server. */
const ReplaySafeMethods = new Set([
    "initialize",
    "ping",
    "tools/list",
    "resources/list",
    "resources/templates/list",
    "prompts/list"
]);

const BridgeErrorCode = -32000;

interface PendingInternal
{
    resolve: (message: JSONRPCMessage) => void;
}

/** One HTTP session with one VS Code window. Replaced wholesale when the window restarts. */
class Upstream
{
    readonly pendingInternal: Map<RequestId, PendingInternal> = new Map<RequestId, PendingInternal>();

    constructor(readonly record: RuntimeRecord, readonly transport: StreamableHTTPClientTransport) { }
}

/**
 * Relays stdio MCP traffic to the owning window's Streamable HTTP endpoint. Endpoints and
 * credentials are resolved from the per-user runtime registry on every (re)connect, so
 * agent configuration only carries the workspace and requested port.
 */
export class StdioBridge
{
    private readonly client: StdioServerTransport;
    private upstream: Upstream | undefined;
    private connecting: Promise<Upstream> | undefined;
    private initializeRequest: JSONRPCRequest | undefined;
    private toolsListChanged: boolean = false;
    private hasConnected: boolean = false;
    private internalIds: number = 0;
    private closed: boolean = false;

    constructor(private readonly options: BridgeOptions)
    {
        this.client = new StdioServerTransport(options.input, options.output);
    }

    async start(): Promise<void>
    {
        this.client.onmessage = (message: JSONRPCMessage) =>
        {
            void this.forward(message, false)
                .catch((error: unknown) => this.log(`Unexpected relay failure: ${errorText(error)}`));
        };
        this.client.onerror = (error: Error) => this.log(`stdio error: ${error.message}`);
        await this.client.start();
    }

    async close(): Promise<void>
    {
        if (this.closed)
        {
            return;
        }
        this.closed = true;
        const upstream = this.upstream;
        this.upstream = undefined;
        if (upstream)
        {
            await upstream.transport.terminateSession().catch(() => undefined);
            await upstream.transport.close().catch(() => undefined);
        }
        await this.client.close();
    }

    private async forward(message: JSONRPCMessage, isRetry: boolean): Promise<void>
    {
        const isInitialize = isJSONRPCRequest(message) && message.method === "initialize";
        if (isInitialize && !isRetry)
        {
            // A client (re)initialize always starts a fresh upstream session.
            this.initializeRequest = message;
            this.dropUpstream(this.upstream);
        }

        let upstream: Upstream;
        try
        {
            upstream = await this.ensureUpstream(!isInitialize);
        }
        catch (error: unknown)
        {
            await this.failRequest(message, errorText(error));
            return;
        }

        try
        {
            await upstream.transport.send(message);
        }
        catch (error: unknown)
        {
            this.dropUpstream(upstream);
            if (!isRetry && (isNotAccepted(error) || isReplaySafe(message)))
            {
                this.log(`Connection to VS Code was lost (${errorText(error)}); reconnecting.`);
                await this.forward(message, true);
                return;
            }
            await this.failRequest(message, isNotAccepted(error)
                ? `VS Code Iteration MCP rejected the request: ${errorText(error)}`
                : "The connection to VS Code was lost while the request was in progress; " +
                `it may or may not have completed. (${errorText(error)})`);
        }
    }

    private ensureUpstream(replayInitialize: boolean): Promise<Upstream>
    {
        if (this.upstream)
        {
            return Promise.resolve(this.upstream);
        }
        if (!this.connecting)
        {
            this.connecting = this.connect(replayInitialize).finally(() =>
            {
                this.connecting = undefined;
            });
        }
        return this.connecting;
    }

    private async connect(replayInitialize: boolean): Promise<Upstream>
    {
        const pollIntervalMs = this.options.pollIntervalMs ?? 250;
        const deadline = Date.now() + this.options.connectTimeoutMs;
        for (;;)
        {
            const result = selectWindow(this.options.registry.list(), {
                requestedPort: this.options.requestedPort,
                workspace: this.options.workspace
            });
            if (Result.isFailure(result) && result.failure.code === "AMBIGUOUS")
            {
                throw new ActionableError(result.failure);
            }
            if (Result.isSuccess(result))
            {
                const upstream = this.createUpstream(result.success);
                try
                {
                    if (replayInitialize && this.initializeRequest)
                    {
                        await this.replayInitialize(upstream);
                    }
                    const reconnected = this.hasConnected;
                    this.hasConnected = true;
                    this.upstream = upstream;
                    if (reconnected && this.toolsListChanged)
                    {
                        // Tools may differ after an extension reload or upgrade.
                        await this.client.send({
                            jsonrpc: "2.0",
                            method: "notifications/tools/list_changed"
                        });
                    }
                    return upstream;
                }
                catch (error: unknown)
                {
                    await upstream.transport.close().catch(() => undefined);
                    if (!isNotAccepted(error) || Date.now() >= deadline)
                    {
                        throw error;
                    }
                    // The window is restarting; its registry entry will be replaced shortly.
                }
            }
            else if (Date.now() >= deadline)
            {
                throw new ActionableError(result.failure);
            }
            await delay(pollIntervalMs);
        }
    }

    private createUpstream(record: RuntimeRecord): Upstream
    {
        const transport = new StreamableHTTPClientTransport(new URL(record.endpoint), {
            requestInit: { headers: { Authorization: `Bearer ${record.token}` } }
        });
        const upstream = new Upstream(record, transport);
        transport.onmessage = (message: JSONRPCMessage) => this.onUpstreamMessage(upstream, message);
        transport.onerror = (error: Error) => this.log(`Upstream error: ${error.message}`);
        return upstream;
    }

    private onUpstreamMessage(upstream: Upstream, message: JSONRPCMessage): void
    {
        if ((isJSONRPCResultResponse(message) || isJSONRPCErrorResponse(message)) && message.id !== undefined)
        {
            const internal = upstream.pendingInternal.get(message.id);
            if (internal)
            {
                upstream.pendingInternal.delete(message.id);
                internal.resolve(message);
                return;
            }
            if (
                isJSONRPCResultResponse(message) &&
                this.initializeRequest &&
                message.id === this.initializeRequest.id
            )
            {
                this.observeInitializeResult(upstream, message.result);
            }
        }
        if (upstream !== this.upstream && this.upstream !== undefined)
        {
            return;
        }

        void this.client
            .send(message)
            .catch((error: unknown) => this.log(`Could not write to client: ${errorText(error)}`));
    }

    private observeInitializeResult(upstream: Upstream, result: Record<string, unknown>): void
    {
        if (typeof result.protocolVersion === "string")
        {
            upstream.transport.setProtocolVersion(result.protocolVersion);
        }
        const capabilities = result.capabilities as { tools?: { listChanged?: boolean } } | undefined;
        this.toolsListChanged = capabilities?.tools?.listChanged === true;
    }

    /** Re-establishes the client's session against a restarted window without involving the client. */
    private async replayInitialize(upstream: Upstream): Promise<void>
    {
        const request = this.initializeRequest!;
        const id = `vscode-iteration-mcp-bridge-reinitialize-${++this.internalIds}`;
        const response: Promise<JSONRPCMessage> = new Promise<JSONRPCMessage>(
            (resolve: (value: JSONRPCMessage | PromiseLike<JSONRPCMessage>) => void) =>
                upstream.pendingInternal.set(id, { resolve })
        );
        await upstream.transport.send({ ...request, id });
        const message = await response;
        if (!isJSONRPCResultResponse(message))
        {
            const error = isJSONRPCErrorResponse(message) ? message.error.message : "unexpected response";
            throw new ActionableError({
                code: "INTERNAL_ERROR",
                message: `Reinitializing the MCP session failed: ${error}`
            });
        }

        this.observeInitializeResult(upstream, message.result);
        await upstream.transport.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    }

    private dropUpstream(upstream: Upstream | undefined): void
    {
        if (!upstream)
        {
            return;
        }
        if (this.upstream === upstream)
        {
            this.upstream = undefined;
        }
        void upstream.transport.close().catch(() => undefined);
    }

    private async failRequest(message: JSONRPCMessage, reason: string): Promise<void>
    {
        if (!isJSONRPCRequest(message))
        {
            this.log(`Dropped message: ${reason}`);
            return;
        }
        await this.client.send({
            error: { code: BridgeErrorCode, message: reason },
            id: message.id,
            jsonrpc: "2.0"
        });
    }

    private log(message: string): void
    {
        this.options.log?.(message);
    }
}

/** True when the server certainly did not process the message, so resending is safe. */
function isNotAccepted(error: unknown): boolean
{
    if (error instanceof StreamableHTTPError)
    {
        return error.code === 401 || error.code === 404;
    }
    const code = (error as { cause?: { code?: string }; code?: string } | undefined)?.cause?.code
    ?? (error as { code?: string } | undefined)?.code;
    return code === "ECONNREFUSED";
}

function isReplaySafe(message: JSONRPCMessage): boolean
{
    return isJSONRPCRequest(message) && ReplaySafeMethods.has(message.method);
}

function errorText(error: unknown): string
{
    if (error instanceof ActionableError)
    {
        return error.details.action ? `${error.message} ${error.details.action}` : error.message;
    }
    return error instanceof Error ? error.message : String(error);
}

function delay(ms: number): Promise<void>
{
    return new Promise((resolve: (value: void | PromiseLike<void>) => void) => setTimeout(resolve, ms));
}
