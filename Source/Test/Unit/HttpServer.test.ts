/**
 * @module vscode-iteration-mcp/Test/Unit/HttpServer.test
 *
 * @file      HttpServer.test.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

import { isAllowedHost, isAllowedOrigin, isAuthorized } from "../../Mcp/Auth";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpTransportHost } from "../../Mcp/Transport";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import assert from "node:assert/strict";
import { createTestTools } from "../../Mcp/TestTools";
import test from "node:test";

async function connect(endpoint: string, token: string): Promise<Client>
{
    const client = new Client({ name: "unit-test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } }
    }));
    return client;
}

function initializeBody(): string
{
    return JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: { capabilities: {}, clientInfo: { name: "raw", version: "1" }, protocolVersion: "2025-06-18" }
    });
}

async function rawPost(endpoint: string, headers: Record<string, string>): Promise<number>
{
    const response = await fetch(endpoint, {
        body: initializeBody(),
        headers: { Accept: "application/json, text/event-stream", "Content-Type": "application/json", ...headers },
        method: "POST"
    });
    await response.body?.cancel();
    return response.status;
}

test("auth helpers accept only the exact bearer token, loopback hosts, and allowed origins", () =>
{
    assert.ok(isAuthorized("Bearer secret", "secret"));
    assert.ok(isAuthorized("bearer secret", "secret"));
    assert.ok(!isAuthorized("Bearer secret2", "secret"));
    assert.ok(!isAuthorized("Basic secret", "secret"));
    assert.ok(!isAuthorized(undefined, "secret"));

    assert.ok(isAllowedHost("127.0.0.1:4000", 4000));
    assert.ok(isAllowedHost("localhost:4000", 4000));
    assert.ok(!isAllowedHost("127.0.0.1:4001", 4000));
    assert.ok(!isAllowedHost("evil.example:4000", 4000));
    assert.ok(!isAllowedHost(undefined, 4000));

    assert.ok(isAllowedOrigin(undefined, 4000));
    assert.ok(isAllowedOrigin("http://127.0.0.1:4000", 4000));
    assert.ok(isAllowedOrigin("vscode-file://vscode-app", 4000));
    assert.ok(!isAllowedOrigin("https://evil.example", 4000));
    assert.ok(!isAllowedOrigin("http://127.0.0.1:4001", 4000));
});

test("a real MCP client initializes, discovers tools, and calls the test handler over HTTP", async (t) =>
{
    const host = new McpTransportHost({ tools: createTestTools("window-a") });
    t.after(() => host.stop());
    const status = await host.start(0);
    assert.equal(status.state, "running");
    assert.equal(status.requestedPort, 0);
    assert.ok(status.actualPort !== undefined && status.actualPort > 0, "port 0 is replaced by the bound port");

    const connection = host.getConnection()!;
    const client = await connect(connection.endpoint, connection.token);
    t.after(() => client.close());

    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name), [ "test_echo" ]);
    assert.equal(tools.tools[0].inputSchema.type, "object");

    const result = await client.callTool({ arguments: { message: "hi" }, name: "test_echo" });
    assert.deepEqual(result.structuredContent, { data: { message: "hi", windowId: "window-a" }, ok: true });
    assert.notEqual(result.isError, true);

    const invalid = await client.callTool({ arguments: { message: 42 }, name: "test_echo" });
    assert.equal(invalid.isError, true);
    assert.equal((invalid.structuredContent as { error: { code: string } }).error.code, "INVALID_ARGUMENT");
});

test("invalid credentials, foreign hosts, and disallowed origins are rejected", async (t) =>
{
    const host = new McpTransportHost();
    t.after(() => host.stop());
    await host.start(0);
    const { endpoint, port, token } = host.getConnection()!;

    assert.equal(await rawPost(endpoint, {}), 401);
    assert.equal(await rawPost(endpoint, { Authorization: "Bearer wrong" }), 401);
    assert.equal(await rawPost(endpoint, { Authorization: `Bearer ${token}`, Origin: "https://evil.example" }), 403);
    assert.equal(await rawPost(endpoint.replace("/mcp", "/other"), { Authorization: `Bearer ${token}` }), 404);
    assert.equal(await rawPost(endpoint, { Authorization: `Bearer ${token}`, Origin: `http://127.0.0.1:${port}` }), 200);

    // fetch cannot override Host, so check DNS-rebinding protection with a raw request.
    const http = await import("node:http");
    const status = await new Promise<number>((resolve, reject) =>
    {
        const request = http.request({
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Host: `evil.example:${port}` },
            host: "127.0.0.1",
            method: "POST",
            path: "/mcp",
            port
        }, (response) =>
        {
            response.resume();
            resolve(response.statusCode ?? 0);
        });
        request.on("error", reject);
        request.end(initializeBody());
    });
    assert.equal(status, 403);
});

test("two windows have independent endpoints and credentials that cannot be crossed", async (t) =>
{
    const a = new McpTransportHost({ tools: createTestTools("window-a") });
    const b = new McpTransportHost({ tools: createTestTools("window-b") });
    t.after(async () =>
    {
        await a.stop();
        await b.stop();
    });
    await a.start(0);
    await b.start(0);
    const ca = a.getConnection()!;
    const cb = b.getConnection()!;
    assert.notEqual(ca.port, cb.port);
    assert.notEqual(ca.token, cb.token);

    assert.equal(await rawPost(cb.endpoint, { Authorization: `Bearer ${ca.token}` }), 401);
    assert.equal(await rawPost(ca.endpoint, { Authorization: `Bearer ${cb.token}` }), 401);

    const client = await connect(cb.endpoint, cb.token);
    t.after(() => client.close());
    const result = await client.callTool({ arguments: { message: "x" }, name: "test_echo" });
    assert.equal((result.structuredContent as { data: { windowId: string } }).data.windowId, "window-b");
});

test("stop releases connections and the port; restart on the same fixed port succeeds", async (t) =>
{
    const host = new McpTransportHost({ tools: createTestTools("window-a") });
    t.after(() => host.stop());
    await host.start(0);
    const first = host.getConnection()!;
    const client = await connect(first.endpoint, first.token);

    await host.stop();
    assert.equal(host.getConnection(), undefined);
    assert.equal(host.getStatus().state, "stopped");
    await assert.rejects(client.callTool({ arguments: { message: "x" }, name: "test_echo" }));
    await client.close();

    const restarted = await host.start(first.port);
    assert.equal(restarted.state, "running");
    assert.equal(restarted.actualPort, first.port);
    assert.equal(restarted.requestedPort, first.port);
});

test("an occupied fixed port is an error with no fallback listener", async (t) =>
{
    const owner = new McpTransportHost();
    const contender = new McpTransportHost();
    t.after(async () =>
    {
        await owner.stop();
        await contender.stop();
    });
    await owner.start(0);
    const occupied = owner.getConnection()!.port;

    const status = await contender.start(occupied);
    assert.equal(status.state, "error");
    assert.equal(status.requestedPort, occupied);
    assert.equal(status.actualPort, undefined);
    assert.match(status.message ?? "", /already in use/);
    assert.equal(contender.getConnection(), undefined);
});
