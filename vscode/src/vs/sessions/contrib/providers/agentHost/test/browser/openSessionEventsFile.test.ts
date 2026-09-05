/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import type { ContextKeyValue, IContext } from '../../../../../../platform/contextkey/common/contextkey.js';
import { IRemoteAgentHostConnectionInfo, RemoteAgentHostConnectionStatus } from '../../../../../../platform/agentHost/common/remoteAgentHostService.js';
import { IsSessionsWindowContext } from '../../../../../../workbench/common/contextkeys.js';
import { OpenSingularityCliStateFileAction } from '../../../../../../workbench/contrib/chat/browser/actions/openSingularityCliStateFileAction.js';
import { ChatContextKeys } from '../../../../../../workbench/contrib/chat/common/actions/chatContextKeys.js';
import { buildLocalSingularityLogsUri, buildRemoteSingularityLogsUri, getSingularityCliSessionRawId, resolveEventsUri } from '../../../../../../workbench/contrib/chat/browser/singularityCliEventsUri.js';
import { IsAgentHostSession } from '../../browser/agentHostSkillButtons.js';
import { OpenSessionEventsFileAction } from '../../browser/openSessionEventsFileActions.js';

suite('openSessionEventsFile resolveEventsUri', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const userHome = URI.file('/home/me');

	function makeRemoteConn(address: string, defaultDirectory: string | undefined): IRemoteAgentHostConnectionInfo {
		return {
			address,
			name: address,
			clientId: 'client-1',
			defaultDirectory,
			status: RemoteAgentHostConnectionStatus.connected,
		};
	}

	function context(values: Record<string, ContextKeyValue>): IContext {
		return {
			getValue: <T extends ContextKeyValue = ContextKeyValue>(key: string): T | undefined => values[key] as T | undefined,
		};
	}

	test('workbench command is disabled in the Agents window', () => {
		const workbenchPrecondition = new OpenSingularityCliStateFileAction().desc.precondition;
		const sessionsPrecondition = new OpenSessionEventsFileAction().desc.precondition;

		assert.deepStrictEqual({
			workbenchVSCodeWindow: workbenchPrecondition?.evaluate(context({
				[ChatContextKeys.enabled.key]: true,
				[IsSessionsWindowContext.key]: false,
			})),
			workbenchAgentsWindow: workbenchPrecondition?.evaluate(context({
				[ChatContextKeys.enabled.key]: true,
				[IsSessionsWindowContext.key]: true,
			})),
			sessionsSingularityCliSession: sessionsPrecondition?.evaluate(context({
				[ChatContextKeys.enabled.key]: true,
				[IsAgentHostSession.key]: false,
			})),
			sessionsAgentHostSession: sessionsPrecondition?.evaluate(context({
				[ChatContextKeys.enabled.key]: true,
				[IsAgentHostSession.key]: true,
			})),
		}, {
			workbenchVSCodeWindow: true,
			workbenchAgentsWindow: false,
			sessionsSingularityCliSession: false,
			sessionsAgentHostSession: true,
		});
	});

	test('local AH singularitycli session resolves to ~/.singularity/session-state/<id>/events.jsonl', () => {
		const result = resolveEventsUri(URI.parse('agent-host-singularitycli:/abc'), userHome, () => undefined);
		assert.deepStrictEqual(
			{ kind: result.kind, resource: result.kind === 'ok' ? result.resource.toString() : undefined },
			{ kind: 'ok', resource: 'file:///home/me/.singularity/session-state/abc/events.jsonl' },
		);
	});

	test('local AH singularitycli session resolves from SINGULARITY_HOME', () => {
		const result = resolveEventsUri(
			URI.parse('agent-host-singularitycli:/abc'),
			userHome,
			() => undefined,
			{ SINGULARITY_HOME: '/custom/singularity' },
		);
		assert.deepStrictEqual(
			{ kind: result.kind, resource: result.kind === 'ok' ? result.resource.toString() : undefined },
			{ kind: 'ok', resource: 'file:///custom/singularity/session-state/abc/events.jsonl' },
		);
	});

	test('singularity log roots resolve beside session-state', () => {
		const conn = makeRemoteConn('localhost:4321', '/home/remote');
		const remoteLogs = buildRemoteSingularityLogsUri(conn);
		assert.deepStrictEqual({
			rawId: getSingularityCliSessionRawId(URI.parse('agent-host-singularitycli:/abc')),
			nonSingularityRawId: getSingularityCliSessionRawId(URI.parse('agent-host-singularity:/abc')),
			localLogs: buildLocalSingularityLogsUri(userHome).toString(),
			remoteLogs: remoteLogs ? {
				scheme: remoteLogs.scheme,
				authority: remoteLogs.authority,
				isLogsPath: remoteLogs.path.endsWith('/home/remote/.singularity/logs'),
			} : undefined,
		}, {
			rawId: 'abc',
			nonSingularityRawId: undefined,
			localLogs: 'file:///home/me/.singularity/logs',
			remoteLogs: {
				scheme: 'vscode-agent-host',
				authority: 'localhost__4321',
				isLogsPath: true,
			},
		});
	});

	test('local singularity log root resolves from SINGULARITY_HOME', () => {
		assert.strictEqual(
			buildLocalSingularityLogsUri(userHome, { SINGULARITY_HOME: '/custom/singularity' }).toString(),
			'file:///custom/singularity/logs',
		);
	});

	test('EH CLI singularitycli session resolves to ~/.singularity/session-state/<id>/events.jsonl', () => {
		const result = resolveEventsUri(URI.parse('singularitycli:/abc'), userHome, () => undefined);
		assert.deepStrictEqual(
			{ kind: result.kind, resource: result.kind === 'ok' ? result.resource.toString() : undefined },
			{ kind: 'ok', resource: 'file:///home/me/.singularity/session-state/abc/events.jsonl' },
		);
	});

	test('remote singularitycli session wraps host events.jsonl in vscode-agent-host URI', () => {
		const conn = makeRemoteConn('localhost:4321', '/home/remote');
		const result = resolveEventsUri(
			URI.parse('remote-localhost__4321-singularitycli:/xyz'),
			userHome,
			authority => authority === 'localhost__4321' ? conn : undefined,
		);
		assert.deepStrictEqual(
			{ kind: result.kind, resource: result.kind === 'ok' ? result.resource.toString() : undefined },
			{ kind: 'ok', resource: 'vscode-agent-host://localhost__4321/home/remote/.singularity/session-state/xyz/events.jsonl?_ah%3DeyJzY2hlbWUiOiJmaWxlIn0' },
		);
	});

	test('remote scheme without an active connection returns remote-not-connected', () => {
		const result = resolveEventsUri(
			URI.parse('remote-myhost-singularitycli:/abc'),
			userHome,
			() => undefined,
		);
		assert.deepStrictEqual(result, { kind: 'remote-not-connected', authority: 'myhost' });
	});

	test('remote scheme without a defaultDirectory returns remote-no-home', () => {
		const conn = makeRemoteConn('myhost', undefined);
		const result = resolveEventsUri(
			URI.parse('remote-myhost-singularitycli:/abc'),
			userHome,
			authority => authority === 'myhost' ? conn : undefined,
		);
		assert.deepStrictEqual(result, { kind: 'remote-no-home', authority: 'myhost' });
	});

	test('unknown scheme returns unsupported-scheme', () => {
		const result = resolveEventsUri(URI.parse('claude:/abc'), userHome, () => undefined);
		assert.deepStrictEqual(result, { kind: 'unsupported-scheme', scheme: 'claude' });
	});

	test('missing session resource returns no-session', () => {
		const result = resolveEventsUri(undefined, userHome, () => undefined);
		assert.deepStrictEqual(result, { kind: 'no-session' });
	});
});
