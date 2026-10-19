/**
 * @module vscode-iteration-mcp/Test/Unit/Disposables.test
 *
 * @file      Disposables.test.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

import assert from "node:assert/strict";
import test from "node:test";
import { DisposableStore } from "../../Core/Disposables";
import { shouldStartServer } from "../../Lifecycle/WorkspaceTrust";

test("untrusted workspaces cannot start the MCP server", () =>
{
    assert.equal(shouldStartServer(false), false);
    assert.equal(shouldStartServer(true), true);
});

test("DisposableStore disposes resources in reverse order and only once", () =>
{
    const events: Array<string> = [];
    const store = new DisposableStore();
    store.add({ dispose: () => events.push("first") });
    store.add({ dispose: () => events.push("second") });

    store.dispose();
    store.dispose();

    assert.deepEqual(events, [ "second", "first" ]);
});

test("DisposableStore immediately disposes resources added after disposal", () =>
{
    const events: Array<string> = [];
    const store = new DisposableStore();
    store.dispose();
    store.add({ dispose: () => events.push("late") });
    assert.deepEqual(events, [ "late" ]);
});
