/**
 * @module vscode-iteration-mcp/Test/Unit/Validation.test
 *
 * @file      Validation.test.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

import assert from "node:assert/strict";
import test from "node:test";
import { Result } from "effect";
import { ActionableError } from "../../Core/Errors";
import { Schema, decodeInput, defineTool } from "../../Core/Validation";

const countInput = Schema.Struct({ count: Schema.Int.check(Schema.isGreaterThan(0)) });

test("decodeInput validates input and produces actionable errors", () =>
{
    assert.deepEqual(Result.getOrThrow(decodeInput(countInput, { count: 2 })), { count: 2 });

    const invalid = decodeInput(countInput, { count: 0 });
    assert.ok(Result.isFailure(invalid));
    assert.equal(invalid.failure.code, "INVALID_ARGUMENT");
});

test("defineTool advertises an object JSON Schema and never throws from call", async () =>
{
    const tool = defineTool({
        name: "count",
        description: "test",
        input: countInput,
        handler: ({ count }) =>
        {
            if (count > 10)
            {
                throw new ActionableError({ code: "NOT_SUPPORTED", message: "too many" });
            }
            return Result.succeed(count * 2);
        }
    });

    assert.equal(tool.inputSchema.type, "object");
    assert.deepEqual((tool.inputSchema as { required?: Array<string> }).required, [ "count" ]);
    assert.deepEqual(await tool.call({ count: 3 }), Result.succeed(6));

    const invalid = await tool.call({ count: "three" });
    assert.ok(Result.isFailure(invalid) && invalid.failure.code === "INVALID_ARGUMENT");

    const thrown = await tool.call({ count: 11 });
    assert.ok(Result.isFailure(thrown) && thrown.failure.code === "NOT_SUPPORTED");
});
