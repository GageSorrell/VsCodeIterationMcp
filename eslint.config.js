/**
 * Monorepo-wide ESLint configuration.
 *
 * `@sorrell/eslint-config` is a flat config (ESLint 9): it already carries
 * its `plugins` (as objects), `files` globs, `extends`, and rules, so it is
 * spread straight into `defineConfig`.  It must *not* be passed through
 * `FlatCompat` — that bridge is only for legacy, eslintrc-shaped configs, and
 * handing it flat plugin objects (whose `@typescript-eslint` entry is a
 * circular graph) crashes ESLint while it tries to JSON-serialize them for
 * schema validation ("Converting circular structure to JSON").
 *
 * @file      eslint.config.js
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

import ReactPerf  from "eslint-plugin-react-perf";
import SorrellConfig from "@sorrell/eslint-config";
import { defineConfig } from "eslint/config";

export default defineConfig(
    SorrellConfig,
    {
        rules:
        {
            "@sorrell/jsdoc-file-name": "error",
            "@typescript-eslint/no-require-imports": "off",
            "jsdoc/no-blank-block-descriptions": "off",
            "jsdoc/require-jsdoc": "off",
            "jsdoc/sort-tags":
            [
                "error",
                {
                    reportIntraTagGroupSpacing: false,
                    reportTagGroupSpacing: false,
                    tagSequence:
                    [
                        {
                            tags:
                            [
                                "module",
                                "internal",
                                "file",
                                "author",
                                "copyright",
                                "license"
                            ]
                        }
                    ]
                }
            ],
            "no-console": "off"
        }
    },
    {
        files:
        [
            "Source/**/*.ts",
            "scripts/**/*.mjs"
        ],
        rules:
        {
            // The project uses explicit types at public boundaries, while local
            // callback variables are intentionally inferred by TypeScript.
            "@typescript-eslint/typedef": "off",
            "@typescript-eslint/naming-convention": "off",
            "@stylistic/max-len": "off",
            "jsdoc/require-file-overview": "off",
            "sort-imports": "off",
            "sort-keys": "off"
        }
    },
    {
        files:
        [
            "scripts/**/*.mjs"
        ],
        languageOptions:
        {
            globals:
            {
                console: "readonly",
                process: "readonly"
            }
        }
    },
    {
        plugins:
        {
            "react-perf": ReactPerf
        },
        rules:
        {
            "react-perf/jsx-no-new-array-as-prop": "warn",
            "react-perf/jsx-no-new-function-as-prop": "warn",
            "react-perf/jsx-no-new-object-as-prop": "warn"
        }
    }
);
