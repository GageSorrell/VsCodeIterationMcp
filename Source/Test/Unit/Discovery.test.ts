/**
 * @module vscode-iteration-mcp/Test/Unit/Discovery.test
 *
 * @file      Discovery.test.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { type RuntimeRecord, RuntimeRegistry } from "../../Runtime/Registry";
import { Result } from "effect";
import assert from "node:assert/strict";
import { selectWindow } from "../../Bridge/Discovery";
import test from "node:test";

function record(windowId: string, folders: Array<string>, port: number, extra: Partial<RuntimeRecord> = {}): RuntimeRecord
{
    return {
        endpoint: `http://127.0.0.1:${port}/mcp`,
        extensionVersion: "0.1.0",
        pid: process.pid,
        port,
        requestedPort: 0,
        schema: 1,
        startedAt: new Date(0).toISOString(),
        token: `token-${windowId}`,
        windowId,
        workspaceFolders: folders,
        ...extra
    };
}

const win = { platform: "win32" as const };

test("selects the window containing the workspace, case-insensitively on Windows", () =>
{
    const records = [ record("a", [ "E:\\Projects\\Alpha" ], 4001), record("b", [ "E:\\Projects\\Beta" ], 4002) ];
    const result = selectWindow(records, { ...win, requestedPort: 0, workspace: "e:\\projects\\beta\\src\\" });
    assert.equal(Result.getOrThrow(result).windowId, "b");
});

test("does not treat a sibling with a shared prefix as containing the workspace", () =>
{
    const records = [ record("a", [ "E:\\Projects\\App" ], 4001) ];
    const result = selectWindow(records, { ...win, requestedPort: 0, workspace: "E:\\Projects\\AppTwo" });
    assert.ok(Result.isFailure(result) && result.failure.code === "NOT_FOUND");
});

test("the most specific owning folder wins; equal matches are ambiguous", () =>
{
    const nested = [ record("outer", [ "E:\\Repo" ], 4001), record("inner", [ "E:\\Repo\\packages\\web" ], 4002) ];
    assert.equal(
        Result.getOrThrow(selectWindow(nested, { ...win, requestedPort: 0, workspace: "E:\\Repo\\packages\\web\\src" })).windowId,
        "inner"
    );
    assert.equal(Result.getOrThrow(selectWindow(nested, { ...win, requestedPort: 0, workspace: "E:\\Repo\\docs" })).windowId, "outer");

    const duplicate = [ record("a", [ "E:\\Repo" ], 4001), record("b", [ "E:\\Repo" ], 4002) ];
    const ambiguous = selectWindow(duplicate, { ...win, requestedPort: 0, workspace: "E:\\Repo" });
    assert.ok(Result.isFailure(ambiguous));
    assert.equal(ambiguous.failure.code, "AMBIGUOUS");
    assert.match(ambiguous.failure.message, /More than one VS Code window/);
    assert.ok(!ambiguous.failure.message.includes("token-"), "credentials never appear in messages");
});

test("a fixed requested port must match the owning window and can disambiguate", () =>
{
    const duplicate = [ record("a", [ "E:\\Repo" ], 4001), record("b", [ "E:\\Repo" ], 4002) ];
    assert.equal(Result.getOrThrow(selectWindow(duplicate, { ...win, requestedPort: 4002, workspace: "E:\\Repo" })).windowId, "b");

    const mismatch = selectWindow(duplicate, { ...win, requestedPort: 4999, workspace: "E:\\Repo" });
    assert.ok(Result.isFailure(mismatch) && /requests port 4999/.test(mismatch.failure.message));
});

test("a port never routes to a window that does not own the workspace", () =>
{
    const records = [ record("other", [ "E:\\Other" ], 4001) ];
    const result = selectWindow(records, { ...win, requestedPort: 4001, workspace: "E:\\Repo" });
    assert.ok(Result.isFailure(result) && result.failure.code === "NOT_FOUND");
});

test("a .code-workspace file selects its window", () =>
{
    const records = [ record("multi", [ "E:\\A", "E:\\B" ], 4001, { workspaceFile: "E:\\ws\\team.code-workspace" }) ];
    assert.equal(
        Result.getOrThrow(selectWindow(records, { ...win, requestedPort: 0, workspace: "E:\\WS\\team.code-workspace" })).windowId,
        "multi"
    );
});

test("the registry lists live records, skips malformed files, and prunes dead owners", (t) =>
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vim-registry-"));
    t.after(() => fs.rmSync(dir, { force: true, recursive: true }));
    const registry = new RuntimeRegistry(dir);
    registry.write(record("live", [ "E:\\Live" ], 4001));
    registry.write(record("dead", [ "E:\\Dead" ], 4002, { pid: 999_999 }));
    fs.writeFileSync(path.join(dir, "garbage.json"), "{not json");

    const isAlive = (pid: number): boolean => pid === process.pid;
    assert.deepEqual(registry.list(isAlive).map((entry) => entry.windowId), [ "live" ]);
    registry.pruneStale(isAlive);
    assert.deepEqual(fs.readdirSync(dir).sort(), [ "garbage.json", "live.json" ]);
    registry.remove("live");
    assert.deepEqual(registry.list(isAlive), []);
});
