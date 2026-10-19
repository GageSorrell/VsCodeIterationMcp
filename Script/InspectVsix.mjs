/**
 * @module vscode-iteration-mcp/Script/InspectVsix
 *
 * @file      InspectVsix.mjs
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

/* eslint-disable @typescript-eslint/typedef, no-undef */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const vsixPath = path.join(root, "dist", "vscode-iteration-mcp.vsix");
if (!fs.existsSync(vsixPath))
{
    throw new Error(`VSIX not found at ${vsixPath}; run npm run package first.`);
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "vscode-iteration-mcp-vsix-inspect-"));
function powershellLiteral(value)
{
    return `'${value.replace(/'/g, "''")}'`;
}

try
{
    execFileSync("powershell.exe", [
        "-NoLogo",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `Expand-Archive -LiteralPath ${powershellLiteral(vsixPath)} -DestinationPath ` +
        `${powershellLiteral(scratch)} -Force`
    ], { stdio: "inherit" });

    const extensionRoot = path.join(scratch, "extension");
    const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, "package.json"), "utf8"));
    if (
        manifest.publisher !== "gage-sorrell" ||
        manifest.name !== "vscode-iteration-mcp" ||
        manifest.version !== "1.0.0"
    )
    {
        throw new Error("packaged manifest identity is inconsistent");
    }

    const required = [
        "readme.md",
        "License.md",
        "Support.md",
        "ThirdPartyNotices.md",
        "resources/icon.png",
        "resources/sidebar-icon.svg",
        "resources/skills/vscode-iteration-mcp/SKILL.md",
        "dist/extension.js"
    ];
    for (const relativePath of required)
    {
        if (!fs.existsSync(path.join(extensionRoot, relativePath)))
        {
            throw new Error(`required packaged file is missing: ${relativePath}`);
        }
    }

    const files = [];
    function collect(directory)
    {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true }))
        {
            const absolute = path.join(directory, entry.name);
            if (entry.isDirectory()) {collect(absolute);}
            else {files.push(path.relative(extensionRoot, absolute).replaceAll(path.sep, "/"));}
        }
    }
    collect(extensionRoot);
    const forbiddenRegexp =
        /^(test-fixtures|\.vscode-test|\.github|scripts)(\/|$)|^(Milestones|Plan)\.md$|^(\.env|\.npmrc)$/;
    const forbidden = files.filter((file) => forbiddenRegexp.test(file));
    if (forbidden.length)
    {
        throw new Error(`development-only files found in VSIX: ${forbidden.join(", ")}`);
    }

    console.log(
        `Inspected ${files.length} packaged files; manifest, public assets, runtime, ` +
        "and exclusions are valid."
    );
}
finally
{
    fs.rmSync(
        scratch,
        {
            force: true,
            maxRetries: 5,
            recursive: true
        });
}
