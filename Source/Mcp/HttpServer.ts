/**
 * @module vscode-iteration-mcp/Mcp/HttpServer
 *
 * @file      HttpServer.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

import * as http from "node:http";
import { LoopbackHost, isAllowedHost, isAllowedOrigin, isAuthorized } from "./Auth";
import { ActionableError } from "../Core/Errors";
import type { AddressInfo } from "node:net";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { ToolDefinition } from "../Core/Validation";
import { createMcpServer } from "./Server";
import { randomUUID } from "node:crypto";

export const McpPath = "/mcp";

export interface HttpServerOptions
{
    requestedPort: number;
    token: string;
    tools?: ReadonlyArray<ToolDefinition>;
    log?: (message: string) => void;
}

interface Session
{
    transport: StreamableHTTPServerTransport;
    server: Server;
}

/**
 * One authenticated Streamable HTTP listener on 127.0.0.1. Each MCP session owns its own
 * protocol server and transport so concurrent clients stay independent.
 */
export class McpHttpServer
{
    private listener: http.Server | undefined;
    private readonly sessions: Map<string, Session> = new Map<string, Session>();
    private boundPort: number = 0;

    constructor(private readonly options: HttpServerOptions) {}

    get port(): number
    {
        return this.boundPort;
    }

    get endpoint(): string
    {
        return `http://${LoopbackHost}:${this.boundPort}${McpPath}`;
    }

    get sessionCount(): number
    {
        return this.sessions.size;
    }

    /**
     * Binds exactly the requested port (0 = OS-assigned). Occupied fixed ports fail; there is no fallback.
     */
    async listen(): Promise<number>
    {
        interface ThisResponse extends http.ServerResponse<http.IncomingMessage>
        {
            req: http.IncomingMessage;
        };

        const listener = http.createServer((request: http.IncomingMessage, response: ThisResponse) =>
        {
            void this.handle(request, response);
        });

        await new Promise<void>((
            resolve: (value: void | PromiseLike<void>) => void,
            reject: (reason?: any) => void
        ) =>
        {
            const onError = (error: NodeJS.ErrnoException): void =>
            {
                listener.off("listening", onListening);
                reject(toListenError(error, this.options.requestedPort));
            };
            const onListening = (): void =>
            {
                listener.off("error", onError);
                resolve();
            };
            listener.once("error", onError);
            listener.once("listening", onListening);
            listener.listen({ exclusive: true, host: LoopbackHost, port: this.options.requestedPort });
        });
        listener.on("error", (error: Error) => this.options.log?.(`HTTP listener error: ${error.message}`));
        this.listener = listener;
        this.boundPort = (listener.address() as AddressInfo).port;
        return this.boundPort;
    }

    /** Closes every MCP session and socket, then releases the port. */
    async close(): Promise<void>
    {
        const sessions = [ ...this.sessions.values() ];
        this.sessions.clear();
        await Promise.allSettled(sessions.map(async ({ transport, server }: Session) =>
        {
            await transport.close();
            await server.close();
        }));
        const listener = this.listener;
        this.listener = undefined;

        if (!listener)
        {
            return;
        }

        await new Promise<void>((resolve: (value: void | PromiseLike<void>) => void) =>
        {
            listener.close(() => resolve());
            listener.closeAllConnections();
        });
    }

    private async handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<void>
    {
        try
        {
            if (!isAllowedHost(request.headers.host, this.boundPort))
            {
                return reject(response, 403, "Host header is not an allowed loopback address.");
            }
            if (!isAllowedOrigin(request.headers.origin, this.boundPort))
            {
                return reject(response, 403, "Request origin is not allowed.");
            }
            if (!isAuthorized(request.headers.authorization, this.options.token))
            {
                response.setHeader("WWW-Authenticate", "Bearer realm=\"vscode-iteration-mcp\"");
                return reject(response, 401, "Missing or invalid bearer token.");
            }
            const url = new URL(request.url ?? "/", `http://${LoopbackHost}`);
            if (url.pathname !== McpPath)
            {
                return reject(response, 404, `Unknown path; the MCP endpoint is ${McpPath}.`);
            }
            if (![ "GET", "POST", "DELETE" ].includes(request.method ?? ""))
            {
                response.setHeader("Allow", "GET, POST, DELETE");
                return reject(response, 405, "Method not allowed.");
            }

            const sessionId = headerValue(request.headers["mcp-session-id"]);
            if (sessionId !== undefined)
            {
                const session = this.sessions.get(sessionId);
                if (!session)
                {
                    return reject(response, 404, "Session not found; reinitialize the MCP connection.");
                }
                await session.transport.handleRequest(request, response);
                return;
            }
            if (request.method !== "POST")
            {
                return reject(response, 400, "An Mcp-Session-Id header is required.");
            }
            await this.handleNewSession(request, response);
        }
        catch (error: unknown)
        {
            this.options.log?.(`Request failed: ${error instanceof Error ? error.message : String(error)}`);
            if (!response.headersSent)
            {
                reject(response, 500, "Internal server error.");
            }
            else
            {
                response.end();
            }
        }
    }

    private async handleNewSession(
        request: http.IncomingMessage,
        response: http.ServerResponse
    ): Promise<void>
    {
        const server = createMcpServer(this.options.tools);
        const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
            enableJsonResponse: true,
            onsessionclosed: (id: string) =>
            {
                this.sessions.delete(id);
            },
            onsessioninitialized: (id: string) =>
            {
                this.sessions.set(id, { server, transport });
            },
            sessionIdGenerator: () => randomUUID()
        });
        transport.onclose = () =>
        {
            if (transport.sessionId !== undefined)
            {
                this.sessions.delete(transport.sessionId);
            }
        };
        await server.connect(transport);
        await transport.handleRequest(request, response);
        if (transport.sessionId === undefined)
        {
            // The request was not a valid initialize; nothing references this pair.
            await transport.close();
            await server.close();
        }
    }
}

function headerValue(value: string | Array<string> | undefined): string | undefined
{
    return Array.isArray(value) ? value[0] : value;
}

function reject(response: http.ServerResponse, status: number, message: string): void
{
    response.statusCode = status;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({
        error: { code: -32000, message },
        id: null,
        jsonrpc: "2.0"
    }));
}

function toListenError(error: NodeJS.ErrnoException, requestedPort: number): ActionableError
{
    if (error.code === "EADDRINUSE")
    {
        return new ActionableError({
            action: "Free the port, choose a different port, or use " +
            "0 for automatic assignment. The server does not fall back to another port.",
            code: "PORT_IN_USE",
            message: `Port ${requestedPort} on ${LoopbackHost} is already in use.`
        });
    }
    if (error.code === "EACCES")
    {
        return new ActionableError({
            action: "Choose a different port, or use 0 for automatic assignment.",
            code: "PORT_IN_USE",
            message: `Port ${requestedPort} on ${LoopbackHost} cannot be bound ` +
            "(access denied or reserved by the OS).`"
        });
    }
    return new ActionableError({
        action: "Check the VS Code Iteration MCP output channel, then restart the server.",
        code: "INTERNAL_ERROR",
        message: `Could not listen on ${LoopbackHost}:${requestedPort}: ${error.message}`
    });
}
