/**
 * @module vscode-iteration-mcp/Test/Unit/Transport.test
 *
 * @file      Transport.test.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

import assert from "node:assert/strict";
import test from "node:test";
import { McpTransportHost } from "../../Mcp/Transport";

test("MCP transport host releases its protocol server on stop", async () =>
{
    const host = new McpTransportHost();
    assert.equal((await host.start(0)).state, "running");
    await host.stop();
    assert.deepEqual(host.getStatus(), { state: "stopped", requestedPort: 0 });
});
