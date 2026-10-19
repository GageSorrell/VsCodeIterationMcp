/**
 * @module vscode-iteration-mcp/Core/Disposables
 *
 * @file      Disposables.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

import type * as vscode from "vscode";

/** Owns resources registered by one extension activation. */
export class DisposableStore implements vscode.Disposable
{
    private readonly disposables: Array<vscode.Disposable> = [];
    private disposed: boolean = false;

    add<Type extends vscode.Disposable>(disposable: Type): Type
    {
        if (this.disposed)
        {
            disposable.dispose();
            return disposable;
        }
        this.disposables.push(disposable);
        return disposable;
    }

    dispose(): void
    {
        if (this.disposed)
        {
            return;
        }
        this.disposed = true;
        for (const disposable of this.disposables.splice(0).reverse())
        {
            try
            {
                disposable.dispose();
            }
            catch
            {
                // Disposal is best effort; one failed resource must not leak the rest.
            }
        }
    }
}
