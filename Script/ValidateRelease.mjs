/**
 * @module vscode-iteration-mcp/Script/ValidateRelease
 *
 * @file      ValidateRelease.mjs
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

/* eslint-disable @typescript-eslint/typedef, no-undef */

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const requiredFiles = [
    "ReadMe.md",
    "Support.md",
    "License.md",
    "ThirdPartyNotices.md",
    "docs/Compatibility.md",
    "docs/ConnectionExamples.md",
    "docs/Publishing.md",
    "resources/icon.png",
    "resources/sidebar-icon.svg",
    "resources/skills/vscode-iteration-mcp/SKILL.md"
];

function fail(message)
{
    console.error(`Release validation failed: ${message}`);
    process.exitCode = 1;
}

function read(relativePath)
{
    return fs.readFileSync(path.join(root, relativePath), "utf8");
}

for (const relativePath of requiredFiles)
{
    if (!fs.existsSync(path.join(root, relativePath)))
    {
        fail(`missing ${relativePath}`);
    }
}

const manifest = JSON.parse(read("package.json"));
if (manifest.name !== "vscode-iteration-mcp" || manifest.publisher !== "gage-sorrell")
{
    fail("manifest identity must remain gage-sorrell.vscode-iteration-mcp");
}
if (
    manifest.version !== "1.0.0" ||
    !/^https:\/\/github\.com\/GageSorrell\/VsCodeIterationMcp(?:\.git)?$/
        .test(manifest.repository?.url ?? "")
)
{
    fail("manifest version or repository metadata is inconsistent");
}
if (manifest.icon !== "resources/icon.png" || manifest.license !== "MIT")
{
    fail("manifest icon and license metadata are inconsistent");
}
if (fs.readdirSync(root).some((entry) => entry === "README.md"))
{
    fail("README.md must not be added beside the required ReadMe.md");
}

const icon = fs.readFileSync(path.join(root, "resources/icon.png"));
if (
    icon.length < 24 ||
    icon.readUInt32BE(0) !== 0x89504e47 ||
    icon.readUInt32BE(16) < 128 ||
    icon.readUInt32BE(20) < 128
)
{
    fail("resources/icon.png must be a PNG at least 128x128");
}

for (const relativePath of [ "ReadMe.md", "Support.md", "docs/Publishing.md" ])
{
    const contents = read(relativePath);
    if (/\b(TODO|TBD|FIXME)\b/i.test(contents))
    {
        fail(`${relativePath} contains an unfinished public placeholder`);
    }
}

if (!process.exitCode)
{
    console.log(`Release metadata validated for ${manifest.publisher}.${manifest.name} ${manifest.version}.`);
}
