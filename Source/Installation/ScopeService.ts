/**
 * @module vscode-iteration-mcp/Installation/ScopeService
 *
 * @file      ScopeService.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

import * as vscode from "vscode";

export type InstallScope =
    | "project"
    | "user"
    | "system";

export interface ScopeContext
{
    scope: InstallScope;
    workspaceFolder?: vscode.WorkspaceFolder;
}

interface ScopePickItem extends vscode.QuickPickItem
{
    scope: InstallScope;
    unavailable?: boolean;
}

interface RootPickItem extends vscode.QuickPickItem
{
    folder: vscode.WorkspaceFolder;
}

type PickResult<Item> =
    | { kind: "selected"; item: Item }
    | { kind: "back" }
    | { kind: "cancel" };

/** Shared default used by the skill and later agent installers. */
export function getDefaultScope(): InstallScope
{
    return vscode.workspace.workspaceFolders?.length ? "project" : "user";
}

/** Opens the native scope-first flow and resolves a workspace root only for Project scope. */
export async function chooseScopeContext(): Promise<ScopeContext | undefined>
{
    for (;;)
    {
        const roots = [ ...(vscode.workspace.workspaceFolders ?? []) ];
        const scopeResult = await pickOne<ScopePickItem>(
            [
                {
                    description: roots.length > 0
                        ? "Install into the selected workspace root"
                        : "Unavailable: open a workspace folder first",
                    label: "Project",
                    scope: "project",
                    unavailable: roots.length === 0
                },
                {
                    description: "Install for this Windows user",
                    label: "User",
                    scope: "user"
                },
                {
                    description: "Install machine-wide (administrator permissions may be required)",
                    label: "System",
                    scope: "system"
                }
            ],
            {
                activeIndex: getDefaultScope() === "project" ? 0 : 1,
                placeHolder: "Choose an installation scope for VS Code Iteration MCP",
                title: "VS Code Iteration MCP: Choose Scope"
            }
        );
        if (scopeResult.kind !== "selected")
        {
            return undefined;
        }
        if (scopeResult.item.unavailable)
        {
            void vscode.window.showInformationMessage(
                "Project scope is unavailable because this window has no workspace " +
                "folder. Choose User or System instead."
            );
            continue;
        }
        if (scopeResult.item.scope !== "project" || roots.length <= 1)
        {
            return {
                scope: scopeResult.item.scope,
                ...(scopeResult.item.scope === "project" && roots[0] !== undefined
                    ? { workspaceFolder: roots[0] }
                    : {})
            };
        }

        const rootResult = await pickOne<RootPickItem>(
            roots.map((folder: vscode.WorkspaceFolder) => ({
                description: folder.uri.fsPath,
                folder,
                label: folder.name
            })),
            {
                buttons: [ vscode.QuickInputButtons.Back ],
                placeHolder: "Choose the workspace root for the Project installation",
                title: "VS Code Iteration MCP: Choose Project Root"
            }
        );
        if (rootResult.kind === "back")
        {
            continue;
        }
        if (rootResult.kind === "cancel")
        {
            return undefined;
        }
        return { scope: "project", workspaceFolder: rootResult.item.folder };
    }
}

/** Chooses only a Project root for actions that intentionally fix scope to Project. */
export async function chooseProjectContext(): Promise<ScopeContext | undefined>
{
    const roots = [ ...(vscode.workspace.workspaceFolders ?? []) ];
    if (roots.length === 0)
    {
        void vscode.window.showInformationMessage(
            "Project scope is unavailable because this window has no workspace folder."
        );
        return undefined;
    }
    if (roots.length === 1)
    {
        return { scope: "project", workspaceFolder: roots[0] };
    }
    const rootResult = await pickOne<RootPickItem>(
        roots.map((folder: vscode.WorkspaceFolder) => ({
            description: folder.uri.fsPath,
            folder,
            label: folder.name
        })),
        {
            buttons: [ vscode.QuickInputButtons.Back ],
            placeHolder: "Choose the workspace root for the Project MCP configuration",
            title: "VS Code Iteration MCP: Choose Project Root"
        }
    );
    return rootResult.kind === "selected"
        ? { scope: "project", workspaceFolder: rootResult.item.folder }
        : undefined;
}

async function pickOne<Item extends vscode.QuickPickItem>(
    items: ReadonlyArray<Item>,
    options: {
        activeIndex?: number;
        buttons?: ReadonlyArray<vscode.QuickInputButton>;
        placeHolder: string;
        title: string;
    }
): Promise<PickResult<Item>>
{
    return new Promise<PickResult<Item>>((
        resolve: (value: PickResult<Item> | PromiseLike<PickResult<Item>>) => void
    ) =>
    {
        const quickPick = vscode.window.createQuickPick<Item>();
        let settled = false;
        const finish = (result: PickResult<Item>): void =>
        {
            if (settled)
            {
                return;
            }
            settled = true;
            for (const disposable of subscriptions)
            {
                disposable.dispose();
            }
            quickPick.dispose();
            resolve(result);
        };
        const subscriptions: Array<vscode.Disposable> = [
            quickPick.onDidAccept(() =>
            {
                const item = quickPick.selectedItems[0];
                finish(item === undefined ? { kind: "cancel" } : { item, kind: "selected" });
            }),
            quickPick.onDidHide(() => finish({ kind: "cancel" }))
        ];
        if (options.buttons !== undefined)
        {
            quickPick.buttons = options.buttons;
            subscriptions.push(quickPick.onDidTriggerButton((button: vscode.QuickInputButton) =>
            {
                if (button === vscode.QuickInputButtons.Back)
                {
                    finish({ kind: "back" });
                }
            }));
        }
        quickPick.items = items;
        quickPick.title = options.title;
        quickPick.placeholder = options.placeHolder;
        if (options.activeIndex !== undefined && items[options.activeIndex] !== undefined)
        {
            quickPick.activeItems = [ items[options.activeIndex] ];
        }
        quickPick.show();
    });
}
