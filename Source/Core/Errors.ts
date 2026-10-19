/**
 * @module vscode-iteration-mcp/Core/Errors
 *
 * @file      Errors.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

export type ErrorCode =
  | "INVALID_ARGUMENT"
  | "NOT_SUPPORTED"
  | "UNSUPPORTED"
  | "NOT_READY"
  | "WORKSPACE_UNTRUSTED"
  | "PORT_IN_USE"
  | "NOT_FOUND"
  | "AMBIGUOUS"
  | "INTERNAL_ERROR";

export interface ActionableErrorDetails
{
    code: ErrorCode;
    message: string;
    action?: string;
}

export class ActionableError extends Error
{
    readonly details: ActionableErrorDetails;

    constructor(details: ActionableErrorDetails)
    {
        super(details.message);
        this.name = "ActionableError";
        this.details = details;
    }
}

export function asActionableError(error: unknown, fallbackAction?: string): ActionableErrorDetails
{
    if (error instanceof ActionableError)
    {
        return error.details;
    }

    return {
        action: fallbackAction,
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : String(error)
    };
}
