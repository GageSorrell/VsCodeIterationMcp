/**
 * @module vscode-iteration-mcp/Test/Unit/PortResolution.test
 *
 * @file      PortResolution.test.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

import { PortOverrideStore, type StateStore, parsePortInput, resolveRequestedPort } from "../../Settings/PortResolution";
import { Result } from "effect";
import assert from "node:assert/strict";
import test from "node:test";

class MemoryState implements StateStore
{
    private readonly values: Map<string, unknown> = new Map<string, unknown>();

    get<T>(key: string): T | undefined
    {
        return this.values.get(key) as T | undefined;
    }

    update(key: string, value: unknown): Thenable<void>
    {
        if (value === undefined)
        {
            this.values.delete(key);
        }
        else
        {
            this.values.set(key, value);
        }
        return Promise.resolve();
    }
}

test("override takes precedence over Workspace/User settings, which take precedence over the default", () =>
{
    assert.deepEqual(Result.getOrThrow(resolveRequestedPort({ source: "workspace", value: 4100 }, 4200)), {
        overridePort: 4200,
        requestedPort: 4200,
        settingPort: 4100,
        settingSource: "workspace",
        source: "override"
    });
    assert.equal(Result.getOrThrow(resolveRequestedPort({ source: "user", value: 4100 }, undefined)).source, "user");
    assert.deepEqual(Result.getOrThrow(resolveRequestedPort({ source: "default", value: 0 }, undefined)), {
        requestedPort: 0,
        settingPort: 0,
        settingSource: "default",
        source: "default"
    });
});

test("an explicit override of 0 requests automatic assignment even when Settings fix a port", () =>
{
    const resolution = Result.getOrThrow(resolveRequestedPort({ source: "user", value: 4100 }, 0));
    assert.equal(resolution.requestedPort, 0);
    assert.equal(resolution.source, "override");
});

test("invalid setting or override values fail instead of falling through", () =>
{
    for (const value of [ -1, 65536, 1.5, "4100", null ])
    {
        const result = resolveRequestedPort({ source: "workspace", value }, undefined);
        assert.ok(Result.isFailure(result) && result.failure.code === "INVALID_ARGUMENT", `setting ${String(value)}`);
    }
    const badOverride = resolveRequestedPort({ source: "default", value: 0 }, 70000);
    assert.ok(Result.isFailure(badOverride) && badOverride.failure.message.includes("override"));
});

test("port input parsing treats blank as no override and rejects non-integers", () =>
{
    assert.deepEqual(parsePortInput("  "), Result.succeed(undefined));
    assert.deepEqual(parsePortInput(" 0 "), Result.succeed(0));
    assert.deepEqual(parsePortInput("65535"), Result.succeed(65535));
    for (const text of [ "-1", "65536", "12.5", "1e3", "abc" ])
    {
        assert.ok(Result.isFailure(parsePortInput(text)), text);
    }
});

test("the override store persists, resets, and rejects invalid ports", async () =>
{
    const state = new MemoryState();
    const store = new PortOverrideStore(state);
    assert.equal(store.get(), undefined);
    await store.set(4300);
    assert.equal(new PortOverrideStore(state).get(), 4300, "a new store over the same workspace state sees the value");
    await store.reset();
    assert.equal(store.get(), undefined);
    await assert.rejects(store.set(70000));
});
