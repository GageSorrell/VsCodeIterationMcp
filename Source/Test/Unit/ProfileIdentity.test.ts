/**
 *
 *
 * @module vscode-iteration-mcp/Test/Unit/ProfileIdentity.test
 *
 * @file      ProfileIdentity.test.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createProfileId, parseProfileId } from "../../Debugger/ProfileIdentity";

test("profile IDs retain source, folder identity, kind, index, and name", () =>
{
    const first = createProfileId({
        folderUri: "file:///E:/workspace/alpha",
        index: 0,
        kind: "configuration",
        name: "Launch: Node",
        source: "launch.json"
    });
    const second = createProfileId({
        folderUri: "file:///E:/workspace/beta",
        index: 0,
        kind: "configuration",
        name: "Launch: Node",
        source: "launch.json"
    });

    assert.notEqual(first, second);
    assert.deepEqual(parseProfileId(first), {
        folderUri: "file:///E:/workspace/alpha",
        index: 0,
        kind: "configuration",
        name: "Launch: Node",
        source: "launch.json"
    });
});

test("malformed profile IDs are rejected", () =>
{
    assert.equal(parseProfileId("not-a-profile-id"), undefined);
    assert.equal(parseProfileId("vscode-iteration-mcp:launch.json:bad:configuration:nope:name"), undefined);
});
