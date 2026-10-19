/**
 * @module vscode-iteration-mcp/Test/Suite/Index
 *
 * @file      Index.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

import * as fs from "node:fs";
import * as path from "node:path";
import Mocha from "mocha";

/** Entry point consumed by VS Code's extension test host. */
export function run(): Promise<void>
{
    const mocha = new Mocha({ ui: "tdd", color: true, timeout: 30_000 });
    for (const file of fs.readdirSync(__dirname).filter((name) => name.endsWith(".test.js")).sort())
    {
        mocha.addFile(path.resolve(__dirname, file));
    }

    return new Promise<void>((resolve, reject) =>
    {
        try
        {
            mocha.run((failures) =>
            {
                if (failures > 0)
                {
                    reject(new Error(`${failures} integration test(s) failed.`));
                }
                else
                {
                    resolve();
                }
            });
        }
        catch (error: unknown)
        {
            reject(error);
        }
    });
}
