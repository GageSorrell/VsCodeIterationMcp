/**
 * @module vscode-iteration-mcp/Core/Validation
 *
 * @file      Validation.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

import { Result, Schema } from "effect";
import type { StructuredResult } from "./Results";
import { asActionableError } from "./Errors";

export { Schema };

/** Tool input schemas decode without Effect services, so validation is synchronous. */
export type ToolInputSchema = Schema.Codec<unknown, unknown, never, never>;

/** Type-erased tool shared by the MCP server; `call` never throws. */
export interface ToolDefinition
{
    readonly name: string;
    readonly description: string;
    /** JSON Schema generated from the Effect schema, advertised through `tools/list`. */
    readonly inputSchema: { type: "object"; [key: string]: unknown };
    readonly call: (args: unknown) => Promise<StructuredResult<unknown>>;
}

export interface ToolSpec<S extends ToolInputSchema, A>
{
    name: string;
    description: string;
    input: S;
    handler: (input: S["Type"]) => StructuredResult<A> | Promise<StructuredResult<A>>;
}

/** Decodes untrusted input, mapping schema issues to an actionable INVALID_ARGUMENT error. */
export function decodeInput<S extends ToolInputSchema>(
    schema: S,
    value: unknown
): StructuredResult<S["Type"]>
{
    return Result.mapError(Schema.decodeUnknownResult(schema)(value), (error: Schema.SchemaError) => ({
        action: "Review the tool schema and provide all required fields with supported values.",
        code: "INVALID_ARGUMENT" as const,
        message: `Tool input is invalid: ${error.message}`
    }));
}

export function toJsonSchema(schema: ToolInputSchema): ToolDefinition["inputSchema"]
{
    const document = Schema.toJsonSchemaDocument(schema);
    const definitions = Object.keys(document.definitions).length > 0 ? { $defs: document.definitions } : {};
    return { ...document.schema, ...definitions, type: "object" };
}

/** Shared boundary for MCP handlers: validate input, run the handler, and never leak exceptions. */
export function defineTool<S extends ToolInputSchema, A>(spec: ToolSpec<S, A>): ToolDefinition
{
    return {
        async call(args: unknown): Promise<StructuredResult<unknown>>
        {
            const input = decodeInput(spec.input, args ?? {});
            if (Result.isFailure(input))
            {
                return input;
            }
            try
            {
                return await spec.handler(input.success);
            }
            catch (error: unknown)
            {
                return Result.fail(asActionableError(
                    error,
                    "Check the VS Code Iteration MCP output channel for details."
                ));
            }
        },
        description: spec.description,
        inputSchema: toJsonSchema(spec.input),
        name: spec.name
    };
}
