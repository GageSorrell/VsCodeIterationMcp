/**
 * @module vscode-iteration-mcp/Debugger/DebuggerService
 *
 * @file      DebuggerService.ts
 * @author    Gage Sorrell <gage@sorrell.sh>
 * @copyright (c) 2026 Gage Sorrell
 * @license   MIT
 */

import * as vscode from "vscode";
import {
    type DebugProfileKind,
    createProfileId,
    parseProfileId
} from "./ProfileIdentity";
import { ActionableError } from "../Core/Errors";
import { executeBuiltInCommand } from "../Commands/CommandCompatibility";

export interface DebugWorkspaceFolderIdentity
{
    readonly index: number;
    readonly name: string;
    readonly path: string;
    readonly uri: string;
}

export interface DebugProfile
{
    readonly id: string;
    readonly kind: DebugProfileKind;
    readonly name: string;
    readonly source: "launch.json";
    readonly workspaceFolder: DebugWorkspaceFolderIdentity;
}

export interface DebugStartResult
{
    readonly kind?: DebugProfileKind;
    readonly name?: string;
    readonly profileId?: string;
    readonly started: true;
    readonly workspaceFolder?: DebugWorkspaceFolderIdentity;
}

export type DebugExecutionState = "running" | "paused" | "terminated" | "unknown";

export type DebugControlAction =
    | "continue"
    | "pause"
    | "step_over"
    | "step_into"
    | "step_out"
    | "restart"
    | "stop"
    | "disconnect"
    | "disconnect_and_suspend"
    | "step_back"
    | "reverse_continue";

export interface DebugSessionStatus
{
    readonly capabilities: Readonly<Record<string, boolean>>;
    readonly id: string;
    readonly lastEvent?: string;
    readonly name: string;
    readonly state: DebugExecutionState;
    readonly threadId?: number;
    readonly type: string;
    readonly workspaceFolder?: DebugWorkspaceFolderIdentity;
}

export interface DebugStatus
{
    readonly activeSession: DebugSessionStatus | null;
    readonly focusedThreadId?: number;
    readonly lastSession?: DebugSessionStatus;
    readonly sessionCount: number;
    readonly state: DebugExecutionState;
}

interface LaunchCompound
{
    readonly name?: unknown;
    readonly [key: string]: unknown;
}

interface ProfileRecord
{
    readonly configuration?: vscode.DebugConfiguration;
    readonly folder: vscode.WorkspaceFolder;
    readonly profile: DebugProfile;
}

const StartDebuggingCommand = "workbench.action.debug.start";

const ControlCommands: Readonly<Record<DebugControlAction, string>> = {
    continue: "workbench.action.debug.continue",
    disconnect: "workbench.action.debug.disconnect",
    disconnect_and_suspend: "workbench.action.debug.disconnectAndSuspend",
    pause: "workbench.action.debug.pause",
    restart: "workbench.action.debug.restart",
    reverse_continue: "workbench.action.debug.reverseContinue",
    step_back: "workbench.action.debug.stepBack",
    step_into: "workbench.action.debug.stepInto",
    step_out: "workbench.action.debug.stepOut",
    step_over: "workbench.action.debug.stepOver",
    stop: "workbench.action.debug.stop"
};

const CapabilityForAction: Partial<Record<DebugControlAction, string>> = {
    disconnect_and_suspend: "supportSuspendDebuggee",
    pause: "supportsPauseRequest",
    restart: "supportsRestartRequest",
    reverse_continue: "supportsReverseContinue",
    step_back: "supportsStepBack"
};

const DapRequestForAction: Partial<Record<DebugControlAction, string>> = {
    continue: "continue",
    pause: "pause",
    step_into: "stepIn",
    step_out: "stepOut",
    step_over: "next"
};

interface SessionObservation
{
    capabilities: Record<string, boolean>;
    lastEvent?: string;
    session: vscode.DebugSession;
    state: DebugExecutionState;
    threadId?: number;
    updatedAt: string;
}

/** Enumerates and launches saved launch.json configurations through stable VS Code APIs. */
export class DebuggerService implements vscode.Disposable
{
    private readonly disposables: Array<vscode.Disposable> = [ ];
    private readonly profilesChanged: vscode.EventEmitter<ReadonlyArray<DebugProfile>> =
        new vscode.EventEmitter<ReadonlyArray<DebugProfile>>();
    private readonly statusChanged: vscode.EventEmitter<DebugStatus> =
        new vscode.EventEmitter<DebugStatus>();
    private profiles: Map<string, ProfileRecord> = new Map<string, ProfileRecord>();
    private readonly sessions: Map<string, SessionObservation> = new Map<string, SessionObservation>();
    private lastActiveSessionId: string | undefined;

    readonly onDidChangeProfiles: vscode.Event<ReadonlyArray<DebugProfile>> = this.profilesChanged.event;

    readonly onDidChangeStatus: vscode.Event<DebugStatus> = this.statusChanged.event;

    constructor()
    {
        this.rebuildProfiles(false);
        this.disposables.push(
            vscode.debug.onDidStartDebugSession((session: vscode.DebugSession) => this.observeStart(session)),
            vscode.debug.onDidChangeActiveDebugSession((session: vscode.DebugSession | undefined) =>
            {
                if (session)
                {
                    this.ensureObservation(session);
                    this.lastActiveSessionId = session.id;
                }
                this.publishStatus();
            }),
            vscode.debug.onDidTerminateDebugSession((session: vscode.DebugSession) =>
            {
                const observation = this.ensureObservation(session);
                this.updateObservation(observation, "terminated", "terminated");
                this.publishStatus();
            }),
            vscode.debug.onDidChangeActiveStackItem(() => this.publishStatus()),
            vscode.debug.registerDebugAdapterTrackerFactory("*", {
                createDebugAdapterTracker: (session: vscode.DebugSession): vscode.DebugAdapterTracker =>
                {
                    this.ensureObservation(session);
                    return {
                        onDidSendMessage: (message: vscode.DebugProtocolMessage) =>
                            this.observeAdapterMessage(session, message)
                    };
                }
            })
        );

        const activeSession = vscode.debug.activeDebugSession;
        if (activeSession)
        {
            this.ensureObservation(activeSession);
            this.lastActiveSessionId = activeSession.id;
        }
    }

    listProfiles(): ReadonlyArray<DebugProfile>
    {
        this.rebuildProfiles(false);
        return [ ...this.profiles.values() ].map(({ profile }: ProfileRecord) => profile);
    }

    /** Refreshes the snapshot after launch.json configuration changes. */
    refresh(): void
    {
        this.rebuildProfiles(true);
    }

    /**
     * Stable VS Code APIs do not expose which launch profile is selected in the UI.
     *
     * @throws {ActionableError} Always.
     */
    getSelectedProfile(): never
    {
        throw new ActionableError({
            action: "Call debug_list_profiles and pass an explicit profileId to debug_start.",
            code: "UNSUPPORTED",
            message: "Selected launch-profile lookup is UNSUPPORTED: VS Code exposes no stable API " +
                "that identifies the profile currently selected in the Run and Debug view."
        });
    }

    async start(profileId?: string): Promise<DebugStartResult>
    {
        if (profileId === undefined)
        {
            // This built-in command resolves to void/undefined in some VS Code versions even
            // when it starts successfully, so command completion—not its return value—is the
            // compatibility signal here.
            try
            {
                await executeBuiltInCommand<unknown>(StartDebuggingCommand);
            }
            catch (error: unknown)
            {
                throw unableToStart("the current VS Code debug selection", error);
            }
            return { started: true };
        }
        if (profileId.trim().length === 0)
        {
            throw new ActionableError({
                action: "Omit profileId to use VS Code's Start Debugging command, " +
                "or pass an ID from debug_list_profiles.",
                code: "INVALID_ARGUMENT",
                message: "profileId cannot be empty."
            });
        }

        this.rebuildProfiles(false);
        const record = this.profiles.get(profileId);
        if (!record)
        {
            const parsed = parseProfileId(profileId);
            throw new ActionableError({
                action: parsed
                    ? "Call debug_list_profiles again; the launch configuration may have "
                        + "changed or its folder may be closed."
                    : "Call debug_list_profiles and pass one of its profile IDs.",
                code: parsed ? "NOT_FOUND" : "INVALID_ARGUMENT",
                message: parsed
                    ? `Debug profile '${profileId}' is stale or no longer exists.`
                    : `Debug profile ID '${profileId}' is not valid.`
            });
        }

        let started: boolean;
        try
        {
            // Passing the saved configuration object back to VS Code is intentional. VS Code
            // remains responsible for variable substitution, pre-launch tasks, prompts, and
            // adapter-specific behavior. Compounds must be addressed by name so VS Code can
            // resolve their child configurations and stopAll semantics itself.
            started = record.profile.kind === "compound"
                ? await vscode.debug.startDebugging(record.folder, record.profile.name)
                : await vscode.debug.startDebugging(record.folder, record.configuration!);
        }
        catch (error: unknown)
        {
            throw unableToStart(`debug profile '${record.profile.name}'`, error);
        }
        if (!started)
        {
            throw new ActionableError({
                action: "Check the Debug Console and launch configuration, then retry the same profile ID.",
                code: "NOT_READY",
                message: `VS Code did not start debug profile '${record.profile.name}'.`
            });
        }
        return {
            kind: record.profile.kind,
            name: record.profile.name,
            profileId: record.profile.id,
            started: true,
            workspaceFolder: record.profile.workspaceFolder
        };
    }

    getStatus(): DebugStatus
    {
        const activeSession = vscode.debug.activeDebugSession;
        if (activeSession)
        {
            this.ensureObservation(activeSession);
            this.lastActiveSessionId = activeSession.id;
        }

        const observation = activeSession ? this.sessions.get(activeSession.id) : undefined;
        const lastObservation = this.lastActiveSessionId
            ? this.sessions.get(this.lastActiveSessionId)
            : undefined;
        const activeStackItem = vscode.debug.activeStackItem;
        const focusedThreadId = activeSession && activeStackItem?.session.id === activeSession.id
            ? activeStackItem.threadId
            : undefined;
        const activeStatus = observation ? this.toSessionStatus(observation, focusedThreadId) : null;
        const lastStatus = !activeStatus && lastObservation?.state === "terminated"
            ? this.toSessionStatus(lastObservation)
            : undefined;

        return {
            activeSession: activeStatus,
            focusedThreadId,
            lastSession: lastStatus,
            sessionCount: [ ...this.sessions.values() ]
                .filter(({ state }: SessionObservation) => state !== "terminated").length,
            state: activeStatus?.state ?? lastStatus?.state ?? "unknown"
        };
    }

    async control(action: DebugControlAction): Promise<DebugStatus>
    {
        const session = vscode.debug.activeDebugSession;
        if (!session)
        {
            throw new ActionableError({
                action: "Start a debug session or select an existing session, then retry.",
                code: "NOT_READY",
                message: `Cannot perform '${action}': there is no active debug session.`
            });
        }

        const observation = this.ensureObservation(session);
        this.validateControlState(action, observation);
        const capability = CapabilityForAction[action];
        if (capability && observation.capabilities[capability] !== true)
        {
            throw new ActionableError({
                action: "Use a debug adapter that advertises this capability, or choose " +
                "a supported control action.",
                code: "NOT_SUPPORTED",
                message: `Debug adapter '${session.type}' does not advertise '${capability}' for '${action}'.`
            });
        }

        const stateBeforeControl = observation.state;
        try
        {
            // Built-in debug actions intentionally receive no session/thread argument. VS Code
            // applies them to the currently focused session and thread, including compounds.
            await executeBuiltInCommand<void>(ControlCommands[action]);

            // Some headless Extension Development Hosts acknowledge the built-in action without
            // forwarding it to the adapter. Give the normal command a chance first, then use the
            // stable DebugSession DAP bridge for state-sensitive actions and the focused thread.
            const dapRequest = DapRequestForAction[action];
            if (dapRequest && observation.state === stateBeforeControl)
            {
                await delay(50);
                if (observation.state === stateBeforeControl)
                {
                    await session.customRequest(
                        dapRequest,
                        await this.focusedThreadArguments(session, observation)
                    );
                }
            }
        }
        catch (error: unknown)
        {
            throw unableToControl(action, error);
        }

        return this.getStatus();
    }

    dispose(): void
    {
        for (const disposable of this.disposables.splice(0))
        {
            disposable.dispose();
        }
        this.statusChanged.dispose();
        this.profilesChanged.dispose();
    }

    private observeStart(session: vscode.DebugSession): void
    {
        this.ensureObservation(session);
        this.lastActiveSessionId = session.id;
        this.publishStatus();
    }

    private ensureObservation(session: vscode.DebugSession): SessionObservation
    {
        const existing = this.sessions.get(session.id);
        if (existing)
        {
            existing.session = session;
            return existing;
        }
        const observation: SessionObservation = {
            capabilities: {},
            session,
            state: "unknown",
            updatedAt: new Date().toISOString()
        };
        this.sessions.set(session.id, observation);
        return observation;
    }

    private observeAdapterMessage(session: vscode.DebugSession, message: vscode.DebugProtocolMessage): void
    {
        const value = asRecord(message);
        if (!value)
        {
            return;
        }
        const observation = this.ensureObservation(session);
        if (value.type === "response" && value.command === "initialize" && value.success === true)
        {
            const body = asRecord(value.body);
            if (body)
            {
                for (const [ key, capability ] of Object.entries(body))
                {
                    if (typeof capability === "boolean")
                    {
                        observation.capabilities[key] = capability;
                    }
                }
            }

            this.publishStatus();

            return;
        }

        if (
            value.type === "response"
            && value.success === true
            && (value.command === "launch" || value.command === "attach")
        )
        {
            this.updateObservation(observation, "running", value.command);
            this.publishStatus();
            return;
        }

        if (value.type !== "event" || typeof value.event !== "string")
        {
            return;
        }
        const body = asRecord(value.body);
        switch (value.event)
        {
            case "continued":
                this.updateObservation(observation, "running", value.event);
                break;
            case "exited":
            case "terminated":
                this.updateObservation(observation, "terminated", value.event);
                break;
            case "stopped":
                this.updateObservation(
                    observation,
                    "paused",
                    value.event,
                    body && typeof body.threadId === "number" ? body.threadId : undefined
                );
                break;
            case "thread":
                if (body && typeof body.threadId === "number")
                {
                    observation.threadId = body.threadId;
                    observation.lastEvent = value.event;
                    observation.updatedAt = new Date().toISOString();
                    this.publishStatus();
                }
                return;
            default:
                return;
        }
        this.publishStatus();
    }

    private updateObservation(
        observation: SessionObservation,
        state: DebugExecutionState,
        event: string,
        threadId?: number
    ): void
    {
        observation.state = state;
        observation.lastEvent = event;
        observation.updatedAt = new Date().toISOString();
        if (threadId !== undefined)
        {
            observation.threadId = threadId;
        }
    }

    private toSessionStatus(observation: SessionObservation, focusedThreadId?: number): DebugSessionStatus
    {
        return {
            capabilities: { ...observation.capabilities },
            id: observation.session.id,
            lastEvent: observation.lastEvent,
            name: observation.session.name,
            state: observation.state,
            threadId: focusedThreadId ?? observation.threadId,
            type: observation.session.type,
            workspaceFolder: observation.session.workspaceFolder
                ? this.workspaceFolderIdentity(observation.session.workspaceFolder)
                : undefined
        };
    }

    private validateControlState(action: DebugControlAction, observation: SessionObservation): void
    {
        const pausedActions: ReadonlyArray<DebugControlAction> = [
            "continue", "step_back", "step_into", "step_out", "step_over", "reverse_continue"
        ];
        if (pausedActions.includes(action) && observation.state !== "paused")
        {
            throw invalidControlState(action, observation.state, "paused");
        }
        if (action === "pause" && observation.state !== "running")
        {
            throw invalidControlState(action, observation.state, "running");
        }
        if (observation.state === "terminated")
        {
            throw new ActionableError({
                action: "Start or select a live debug session, then retry.",
                code: "NOT_READY",
                message: `Cannot perform '${action}': the active debug session has terminated.`
            });
        }
    }

    private async focusedThreadArguments(
        session: vscode.DebugSession,
        observation: SessionObservation
    ): Promise<{ threadId?: number } | undefined>
    {
        const activeStackItem = vscode.debug.activeStackItem;
        let threadId = activeStackItem?.session.id === session.id
            ? activeStackItem.threadId
            : observation.threadId;
        // Some adapters emit threadId 0 for a synthetic startup/process thread. Ask the
        // adapter for its real thread list before falling back to the all-thread form.
        if (threadId === undefined || threadId <= 0)
        {
            try
            {
                const response = asRecord(await session.customRequest("threads"));
                const threads = response && Array.isArray(response.threads) ? response.threads : [];
                const firstThread = threads.find((value: unknown) =>
                {
                    const record = asRecord(value);
                    return record !== undefined && typeof record.id === "number" && record.id > 0;
                });
                const firstThreadRecord = asRecord(firstThread);
                threadId = firstThreadRecord?.id as number | undefined;
            }
            catch
            {
                threadId = undefined;
            }
        }
        return threadId === undefined || threadId <= 0 ? undefined : { threadId };
    }

    private publishStatus(): void
    {
        this.statusChanged.fire(this.getStatus());
    }

    private rebuildProfiles(emit: boolean): void
    {
        const next = new Map<string, ProfileRecord>();
        for (const folder of vscode.workspace.workspaceFolders ?? [])
        {
            const identity = this.workspaceFolderIdentity(folder);
            const launch = vscode.workspace.getConfiguration("launch", folder.uri);
            const configurations = asArray(launch.get<unknown>("configurations", []));
            configurations.forEach((value: unknown, index: number) =>
            {
                const configuration = asDebugConfiguration(value);
                if (!configuration)
                {
                    return;
                }

                const profile = this.createProfile(
                    "configuration",
                    configuration.name,
                    folder,
                    index,
                    identity
                );

                next.set(profile.id, { configuration, folder, profile });
            });

            const compounds = asArray(launch.get<unknown>("compounds", [ ]));
            compounds.forEach((value: unknown, index: number) =>
            {
                const compound = asLaunchCompound(value);
                if (!compound || typeof compound.name !== "string" || compound.name.trim().length === 0)
                {
                    return;
                }
                const profile = this.createProfile("compound", compound.name, folder, index, identity);
                next.set(profile.id, { folder, profile });
            });
        }

        const changed = emit && !sameProfileIds(this.profiles, next);
        this.profiles = next;
        if (changed)
        {
            this.profilesChanged.fire([ ...next.values() ].map(({ profile }: ProfileRecord) => profile));
        }
    }

    private createProfile(
        kind: DebugProfileKind,
        name: string,
        folder: vscode.WorkspaceFolder,
        index: number,
        identity: DebugWorkspaceFolderIdentity
    ): DebugProfile
    {
        return {
            id: createProfileId({
                folderUri: folder.uri.toString(),
                index,
                kind,
                name,
                source: "launch.json"
            }),
            kind,
            name,
            source: "launch.json",
            workspaceFolder: identity
        };
    }

    private workspaceFolderIdentity(folder: vscode.WorkspaceFolder): DebugWorkspaceFolderIdentity
    {
        return {
            index: folder.index,
            name: folder.name,
            path: folder.uri.fsPath,
            uri: folder.uri.toString()
        };
    }
}

function asArray(value: unknown): Array<unknown>
{
    return Array.isArray(value) ? value : [];
}

function unableToStart(target: string, error: unknown): ActionableError
{
    if (error instanceof ActionableError)
    {
        return error;
    }
    const reason = error instanceof Error ? ` ${error.message}` : "";
    return new ActionableError({
        action: "Check the Debug Console and launch configuration, then retry.",
        code: "NOT_READY",
        message: `VS Code could not start ${target}.${reason}`
    });
}

function unableToControl(action: DebugControlAction, error: unknown): ActionableError
{
    if (error instanceof ActionableError)
    {
        return error;
    }
    const reason = error instanceof Error ? ` ${error.message}` : "";
    return new ActionableError({
        action: "Check the active debug session and adapter capabilities, then retry.",
        code: "NOT_READY",
        message: `VS Code could not perform '${action}'.${reason}`
    });
}

function invalidControlState(
    action: DebugControlAction,
    actual: DebugExecutionState,
    expected: DebugExecutionState
): ActionableError
{
    return new ActionableError({
        action: `Wait until the session is observed as ${expected}, then retry '${action}'.`,
        code: "NOT_READY",
        message: `Cannot perform '${action}' while the active debug session state is '${actual}'.`
    });
}

function asRecord(value: unknown): Record<string, unknown> | undefined
{
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}

function delay(milliseconds: number): Promise<void>
{
    type ThisResolver = (_: void | PromiseLike<void>) => void;
    return new Promise((resolve: ThisResolver) => setTimeout(resolve, milliseconds));
}

function asDebugConfiguration(value: unknown): vscode.DebugConfiguration | undefined
{
    if (!isRecord(value) || typeof value.name !== "string" || value.name.trim().length === 0)
    {
        return undefined;
    }

    return value as vscode.DebugConfiguration;
}

function asLaunchCompound(value: unknown): LaunchCompound | undefined
{
    return isRecord(value) ? value as LaunchCompound : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown>
{
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameProfileIds(
    previous: Map<string, ProfileRecord>,
    next: Map<string, ProfileRecord>
): boolean
{
    if (previous.size !== next.size)
    {
        return false;
    }
    for (const id of previous.keys())
    {
        if (!next.has(id))
        {
            return false;
        }
    }
    return true;
}
