# Milestones 10–11 validation record

Validation is local and Windows-targeted. No Marketplace login, publication, upload, or release tagging was performed.

## Commands

```powershell
npm ci
npm run check
npm test
npm run test:integration
npm run test:vsix
npm run test:clean-profile
npm run inspect:vsix
```

The Extension Development Host tests use disposable workspace copies and isolated runtime, Claude skill, and Codex config homes. They do not write the developer's live agent configuration.

## Verified coverage

- 32 focused Node unit tests covering discovery/routing, bridge arguments and launcher behavior, validation, authentication, transport lifecycle, port precedence, profile identity, and disposable resources.
- 21 Windows Extension Development Host tests covering HTTP and stdio MCP initialization, tool discovery/calls, launch profiles, compounds, pause/continue/stepping/restart/stop, terminal creation/switching/input/scrollback, clipboard preservation, workspace trust, Settings/override precedence, fixed-port failure, skill installation, native agent config merging, project mismatch repair, and sidebar manifest contributions.
- The packaged VSIX runner extracts `dist/vscode-iteration-mcp.vsix` into a temporary directory and runs the same Extension Development Host suite against packaged files rather than the repository source tree.
- The clean-profile runner installs `dist/vscode-iteration-mcp.vsix` with the VS Code CLI into a disposable user-data/extensions directory, then runs the same suite from the installed extension directory.
- The packaged manifest includes the Activity Bar icon, primary sidebar view, Settings contribution, commands, bridge, bundled skill, and runtime files required by the extension.

## Manual or environment-gated checks

- System-scope Claude Code writes require administrator permissions and were not run against live machine configuration. The UI confirms the exact destination and managed MCP effect before writing.
- Codex native Windows System discovery remains unsupported and is reported as a partial result; no guessed machine-wide path is written.
- A full interactive VS Code window reload should be checked in a clean profile before release; the runtime registry and launcher are designed for reload/reconnect, while automated tests cover stop/restart and packaged activation without mutating the developer profile.

## Release handoff

The local VSIX is generated at `dist/vscode-iteration-mcp.vsix`. The compatibility matrix is in [Compatibility.md](Compatibility.md), connection/setup examples are in [ConnectionExamples.md](ConnectionExamples.md), and publication instructions are in [Publishing.md](Publishing.md). The README includes sanitized UI references with alt text; a final Marketplace review should recapture the sidebar and setup prompts from a clean-profile window before publication.

`vsce` emits the standard performance advisory about unbundled JavaScript files. It is recorded in [Publishing.md](Publishing.md); the local VSIX remains installable and passes both packaged-file and clean-profile validation.
