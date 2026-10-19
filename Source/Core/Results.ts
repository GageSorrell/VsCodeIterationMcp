/**
 * @module vscode-iteration-mcp/Core/Results
 *
 * @file      Results.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

import type { ActionableErrorDetails } from "./Errors";
import { Result } from "effect";

/** Outcome of an operation that fails with an actionable error. Build with `Result.succeed`/`Result.fail`. */
export type StructuredResult<A> = Result.Result<A, ActionableErrorDetails>;

/** Stable JSON shape sent to MCP clients; Effect's internal tags are not part of the wire format. */
export type WireResult<A> =
  | { ok: true; data: A }
  | { ok: false; error: ActionableErrorDetails };

export function toWireResult<A>(result: StructuredResult<A>): WireResult<A>
{
    return Result.match(result, {
        onFailure: (error: ActionableErrorDetails): WireResult<A> => ({ error, ok: false }),
        onSuccess: (data: A): WireResult<A> => ({ data, ok: true })
    });
}
