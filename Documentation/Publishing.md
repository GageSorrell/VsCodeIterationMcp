# Publishing preparation

This document describes how to reproduce and review a future Marketplace release. It does not log in to the Marketplace, create accounts, upload packages, or publish the extension.

## Current release identity

- Package name: `vscode-iteration-mcp`
- Display name: VS Code Iteration MCP
- Candidate publisher ID: `gage-sorrell`
- Candidate extension ID: `gage-sorrell.vscode-iteration-mcp`
- Candidate version: `0.1.0`
- Repository: <https://github.com/GageSorrell/VsCodeIterationMcp>
- Release branch: `Master`
- Target: Windows desktop x64 with VS Code 1.142.0 or later

The publisher ID is derived from the maintainer-owned GitHub origin but still requires verification against the maintainer's actual Marketplace publisher account before publication. Until that check is complete, the VSIX is a local release candidate rather than a Marketplace listing.

## Reproduce the reviewed package

On Windows:

```powershell
npm ci
npm run validate:release
npm run check
npm test
npm run test:integration
npm run test:vsix
npm run test:clean-profile
npm run package
npm run inspect:vsix
```

`@vscode/vsce` is pinned in `package.json` and `package-lock.json`. The package command uses `ReadMe.md`, includes production dependencies, includes the PNG Marketplace icon, and excludes source, tests, CI files, plans, fixtures, maps, and local state according to `.vscodeignore`.

The current package emits only the standard `vsce` performance advisory about unbundled JavaScript files. It is documented rather than hidden: the extension uses the stable TypeScript output and its packaged clean-profile workflow passes. A future release may add a bundler after measuring startup and source-map tradeoffs.

Before a future release, inspect the VSIX file list and manifest, confirm that no credentials or personal paths are present, install the package in a fresh VS Code profile, and exercise the sidebar, Settings, HTTP/stdio connection, debug, terminal, and skill flows using only packaged files.

## Versioning

1. Confirm the publisher account and final extension identity.
2. Update the SemVer `version` in `package.json`.
3. Run the complete validation sequence above.
4. Review the VSIX contents and generated size.
5. Obtain the maintainer's explicit publication approval before using `vsce publish`.

Do not publish from CI. Windows CI only validates and uploads an artifact; it has no Marketplace credentials.

## Required future review gates

- Verify the `gage-sorrell` Marketplace publisher account and ownership of the stable extension ID.
- Capture and review screenshots from a clean packaged install, with credentials and personal paths redacted and alt text in the README.
- Confirm the Marketplace PNG icon, public README rendering, repository links, support path, license, and third-party notices.
- Reconfirm the Windows/VS Code compatibility matrix and any native System-scope changes.
- Decide whether the current local bearer-token and stdio discovery design satisfies the intended release threat model; do not add hosted authentication or telemetry implicitly.
- Resolve any dependency license or Marketplace policy findings before publication.
