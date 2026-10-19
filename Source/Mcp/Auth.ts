/**
 * @module vscode-iteration-mcp/Mcp/Auth
 *
 * @file      Auth.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const LoopbackHost: string = "127.0.0.1";

/** VS Code's own workbench origin; extension-host clients normally send no Origin at all. */
const VsCodeWorkbenchOrigin = "vscode-file://vscode-app";

export function generateToken(): string
{
    return randomBytes(32).toString("base64url");
}

/** Constant-time bearer check; hashing first keeps lengths equal for timingSafeEqual. */
export function isAuthorized(authorizationHeader: string | undefined, token: string): boolean
{
    const match = /^Bearer\s+(\S+)\s*$/i.exec(authorizationHeader ?? "");
    if (!match)
    {
        return false;
    }
    const presented = createHash("sha256").update(match[1]).digest();
    const expected = createHash("sha256").update(token).digest();
    return timingSafeEqual(presented, expected);
}

/** DNS-rebinding protection: only loopback host names for the bound port are accepted. */
export function isAllowedHost(hostHeader: string | undefined, port: number): boolean
{
    if (!hostHeader)
    {
        return false;
    }
    const host = hostHeader.toLowerCase();
    return host === `${LoopbackHost}:${port}` || host === `localhost:${port}`;
}

/**
 * Non-browser clients send no Origin. When one is present it must be this server's own
 * loopback origin or the VS Code workbench; any other web page is rejected.
 */
export function isAllowedOrigin(originHeader: string | undefined, port: number): boolean
{
    if (originHeader === undefined)
    {
        return true;
    }
    const origin = originHeader.toLowerCase();
    return origin === `http://${LoopbackHost}:${port}`
    || origin === `http://localhost:${port}`
    || origin === VsCodeWorkbenchOrigin;
}
