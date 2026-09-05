/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SessionEventPayload } from '@github/copilot-sdk';
import { getErrorCode } from '../../../../base/common/errors.js';
import type { URI } from '../../../../base/common/uri.js';
import { packErrorForTelemetry } from '../../../telemetry/common/errorTelemetry.js';
import type { ITelemetryService } from '../../../telemetry/common/telemetry.js';
import { AgentSession } from '../../common/agentService.js';
import { getTelemetryChatSessionId } from '../../common/agentTelemetryCorrelation.js';

export type SingularityClientFailureOperation = 'abort' | 'changeAgent' | 'changeModel' | 'getSessionMetadata' | 'listSessions' | 'modelRefresh' | 'sendMessage' | 'startClient';
export type SingularityClientFailureKind = 'clientNotConnected' | 'connectionClosed' | 'connectionDisposed' | 'runtimeConnectionClosed' | 'startupFailed';

export interface ISingularityFailureCorrelation {
	readonly agentSessionId?: string;
	readonly chatSessionId?: string;
	readonly turnId?: string;
	readonly sdkSessionId?: string;
}

type SingularitySessionFailureCorrelation = {
	readonly agentSessionId: string;
	readonly chatSessionId: string;
	readonly turnId: string | undefined;
	readonly sdkSessionId: string;
};

export function createSingularityFailureCorrelation(sessionUri: URI, chatUri: URI, turnId: string | undefined, sdkSessionId: string): SingularitySessionFailureCorrelation {
	return {
		agentSessionId: AgentSession.id(sessionUri),
		chatSessionId: getTelemetryChatSessionId(chatUri),
		turnId: turnId || undefined,
		sdkSessionId,
	};
}

export function classifySingularityClientFailure(error: unknown): SingularityClientFailureKind | undefined {
	if (!(error instanceof Error)) {
		return undefined;
	}
	switch (error.message) {
		case 'Client not connected':
			return 'clientNotConnected';
		case 'Connection is closed.':
			return 'connectionClosed';
		case 'Connection is disposed.':
			return 'connectionDisposed';
		case 'The in-process runtime connection is closed.':
			return 'runtimeConnectionClosed';
	}
	return error.message.startsWith('Failed to start CLI server:')
		|| error.message.startsWith('CLI server exited with code ')
		|| error.message.startsWith('CLI server exited unexpectedly with code ')
		? 'startupFailed'
		: undefined;
}

type SingularityClientFailureEvent = ISingularityFailureCorrelation & {
	clientFailureId: string;
	failureKind: SingularityClientFailureKind;
	operation: SingularityClientFailureOperation;
	activeTurnCount: number;
	recoveryStarted: boolean;
	errorName: string | undefined;
	errorCode: string | undefined;
	msg: string;
	callstack: string | undefined;
};

type SingularityClientFailureClassification = {
	clientFailureId: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'Identifier shared by detections and recovery telemetry for one Singularity client failure episode.' };
	failureKind: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The bounded category of Singularity client failure that was detected.' };
	operation: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The Singularity provider operation that detected the client failure.' };
	agentSessionId?: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The Agent Host session identifier, when the failing operation targeted a session.' };
	chatSessionId?: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The Agent Host chat identifier, when the failing operation targeted a chat.' };
	turnId?: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The Agent Host turn identifier, when available.' };
	sdkSessionId?: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The Singularity SDK session identifier, when available.' };
	activeTurnCount: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'The number of Singularity chats with an active turn when the client failure was detected.' };
	recoveryStarted: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'Whether this detection started client recovery instead of joining recovery already in progress.' };
	errorName: { classification: 'CallstackOrException'; purpose: 'PerformanceAndHealth'; comment: 'The name of the client failure exception, when available.' };
	errorCode: { classification: 'CallstackOrException'; purpose: 'PerformanceAndHealth'; comment: 'The client failure exception or protocol error code, when available.' };
	msg: { classification: 'CallstackOrException'; purpose: 'PerformanceAndHealth'; comment: 'The client failure message. VS Code telemetry scrubs file paths and likely secrets before transmission.' };
	callstack: { classification: 'CallstackOrException'; purpose: 'PerformanceAndHealth'; comment: 'The client failure stack. VS Code telemetry scrubs file paths and likely secrets before transmission.' };
	owner: 'roblourens';
	comment: 'Tracks detected Singularity client failures and whether recovery was started.';
};

export function reportSingularityClientFailure(
	telemetryService: ITelemetryService,
	clientFailureId: string,
	failureKind: SingularityClientFailureKind,
	operation: SingularityClientFailureOperation,
	activeTurnCount: number,
	recoveryStarted: boolean,
	error: unknown,
	correlation?: ISingularityFailureCorrelation,
): void {
	const packed = packErrorForTelemetry(error);
	telemetryService.publicLogError2<SingularityClientFailureEvent, SingularityClientFailureClassification>('agentHost.singularityClientFailure', {
		clientFailureId,
		failureKind,
		operation,
		...correlation,
		activeTurnCount,
		recoveryStarted,
		errorName: error instanceof Error ? error.name : undefined,
		errorCode: getErrorCode(error),
		msg: packed.msg,
		callstack: packed.callstack,
	});
}

type SingularityClientRecoveryEvent = {
	clientFailureId: string;
	failureKind: SingularityClientFailureKind;
	durationMs: number;
	failedTurnCount: number;
	stopSucceeded: boolean;
};

type SingularityClientRecoveryClassification = {
	clientFailureId: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'Identifier shared by detections and recovery telemetry for one Singularity client failure episode.' };
	failureKind: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The bounded category of Singularity client failure that initiated recovery.' };
	durationMs: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'Time in milliseconds spent recovering the failed Singularity client.' };
	failedTurnCount: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'Number of active Agent Host turns failed during client recovery.' };
	stopSucceeded: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'Whether stopping the failed Singularity client completed without throwing.' };
	owner: 'roblourens';
	comment: 'Tracks the outcome of Singularity client recovery.';
};

export function reportSingularityClientRecovery(telemetryService: ITelemetryService, event: SingularityClientRecoveryEvent): void {
	telemetryService.publicLog2<SingularityClientRecoveryEvent, SingularityClientRecoveryClassification>('agentHost.singularityClientRecovery', event);
}

type SingularityClientRecoveryTurnEvent = SingularitySessionFailureCorrelation & {
	clientFailureId: string;
};

type SingularityClientRecoveryTurnClassification = {
	clientFailureId: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'Identifier shared by all telemetry for one Singularity client failure episode.' };
	agentSessionId: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The Agent Host session identifier.' };
	chatSessionId: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The Agent Host chat identifier.' };
	turnId: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The Agent Host turn failed during client recovery.' };
	sdkSessionId: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The Singularity SDK session identifier.' };
	owner: 'roblourens';
	comment: 'Correlates each turn failed during Singularity client recovery with its client failure episode.';
};

export function reportSingularityClientRecoveryTurn(telemetryService: ITelemetryService, clientFailureId: string, correlation: SingularitySessionFailureCorrelation): void {
	telemetryService.publicLogError2<SingularityClientRecoveryTurnEvent, SingularityClientRecoveryTurnClassification>('agentHost.singularityClientRecoveryTurnFailed', {
		clientFailureId,
		...correlation,
	});
}

type SingularitySdkSessionErrorEvent = SingularitySessionFailureCorrelation & {
	sdkEventId: string;
	sdkParentEventId: string | undefined;
	sdkAgentId: string | undefined;
	errorType: string;
	errorCode: string | undefined;
	statusCode: number | undefined;
	providerCallId: string | undefined;
	serviceRequestId: string | undefined;
	eligibleForAutoSwitch: boolean | undefined;
	msg: string;
	callstack: string | undefined;
};

type SingularitySdkSessionErrorClassification = {
	agentSessionId: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The Agent Host session identifier.' };
	chatSessionId: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The Agent Host chat identifier.' };
	turnId: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The Agent Host turn identifier, when available.' };
	sdkSessionId: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The Singularity SDK session identifier.' };
	sdkEventId: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The Singularity SDK event identifier.' };
	sdkParentEventId: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The preceding Singularity SDK event identifier, when available.' };
	sdkAgentId: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The Singularity SDK subagent identifier, when applicable.' };
	errorType: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The structured Singularity SDK session error type.' };
	errorCode: { classification: 'CallstackOrException'; purpose: 'PerformanceAndHealth'; comment: 'The upstream provider error code, when available.' };
	statusCode: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'The upstream HTTP status code, when available.' };
	providerCallId: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The GitHub provider request identifier, when available.' };
	serviceRequestId: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The Singularity service request identifier, when available.' };
	eligibleForAutoSwitch: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'Whether the error can trigger an Auto model switch.' };
	msg: { classification: 'CallstackOrException'; purpose: 'PerformanceAndHealth'; comment: 'The SDK session error message. VS Code telemetry scrubs file paths and likely secrets before transmission.' };
	callstack: { classification: 'CallstackOrException'; purpose: 'PerformanceAndHealth'; comment: 'The SDK session error stack. VS Code telemetry scrubs file paths and likely secrets before transmission.' };
	owner: 'roblourens';
	comment: 'Captures Singularity SDK session errors with Agent Host, SDK, and provider correlation identifiers.';
};

export function reportSingularitySdkSessionError(telemetryService: ITelemetryService, event: SessionEventPayload<'session.error'>, correlation: SingularitySessionFailureCorrelation): void {
	telemetryService.publicLogError2<SingularitySdkSessionErrorEvent, SingularitySdkSessionErrorClassification>('agentHost.singularitySdkSessionError', {
		...correlation,
		sdkEventId: event.id,
		sdkParentEventId: event.parentId ?? undefined,
		sdkAgentId: event.agentId,
		errorType: event.data.errorType,
		errorCode: event.data.errorCode,
		statusCode: event.data.statusCode,
		providerCallId: event.data.providerCallId,
		serviceRequestId: event.data.serviceRequestId,
		eligibleForAutoSwitch: event.data.eligibleForAutoSwitch,
		msg: event.data.message,
		callstack: event.data.stack,
	});
}

type SingularityModelCallFailureEvent = SingularitySessionFailureCorrelation & {
	sdkEventId: string;
	sdkParentEventId: string | undefined;
	sdkAgentId: string | undefined;
	failureKind: string | undefined;
	source: string;
	transport: string | undefined;
	apiEndpoint: string | undefined;
	statusCode: number | undefined;
	durationMs: number | undefined;
	model: string | undefined;
	reasoningEffort: string | undefined;
	isAuto: boolean | undefined;
	isByok: boolean | undefined;
	rte: boolean | undefined;
	badRequestKind: string | undefined;
	apiCallId: string | undefined;
	providerCallId: string | undefined;
	serviceRequestId: string | undefined;
	messageCount: number | undefined;
	toolCallCount: number | undefined;
	toolResultMessageCount: number | undefined;
	namelessToolCallCount: number | undefined;
	imagePartCount: number | undefined;
	imagePartsMissingMediaType: number | undefined;
};

type SingularityModelCallFailureClassification = {
	agentSessionId: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The Agent Host session identifier.' };
	chatSessionId: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The Agent Host chat identifier.' };
	turnId: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The Agent Host turn identifier, when available.' };
	sdkSessionId: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The Singularity SDK session identifier.' };
	sdkEventId: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The Singularity SDK event identifier.' };
	sdkParentEventId: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The preceding Singularity SDK event identifier, when available.' };
	sdkAgentId: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The Singularity SDK subagent identifier, when applicable.' };
	failureKind: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'Whether the SDK model call failed at the API or transport boundary.' };
	source: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'Whether the model call came from the top-level agent, a subagent, or MCP sampling.' };
	transport: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The HTTP or WebSocket transport used by the failed model call.' };
	apiEndpoint: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The bounded API endpoint used by the failed model call.' };
	statusCode: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'The HTTP status code, when available.' };
	durationMs: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'Duration of the failed model call in milliseconds.' };
	model: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The provider model identifier used by the failed call.' };
	reasoningEffort: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The reasoning effort used by the failed call, when applicable.' };
	isAuto: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'Whether Auto selected the model for the failed call.' };
	isByok: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'Whether the failed call used a bring-your-own-key provider.' };
	rte: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'The SDK runtime RTE flag for the failed call, when available.' };
	badRequestKind: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The bounded HTTP 400 response category, when available.' };
	apiCallId: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The model-provider completion identifier, when available.' };
	providerCallId: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The GitHub provider request identifier, when available.' };
	serviceRequestId: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The Singularity service request identifier, when available.' };
	messageCount: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'Number of messages in the failing request.' };
	toolCallCount: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'Number of tool calls in the failing request.' };
	toolResultMessageCount: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'Number of tool-result messages in the failing request.' };
	namelessToolCallCount: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'Number of tool calls with no name in the failing request.' };
	imagePartCount: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'Number of image parts in the failing request.' };
	imagePartsMissingMediaType: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'Number of image parts missing a media type in the failing request.' };
	owner: 'roblourens';
	comment: 'Captures structured Singularity SDK model-call failures. Raw model error messages remain restricted to SDK-owned telemetry and are not duplicated here.';
};

export function reportSingularityModelCallFailure(telemetryService: ITelemetryService, event: SessionEventPayload<'model.call_failure'>, correlation: SingularitySessionFailureCorrelation): void {
	const fingerprint = event.data.requestFingerprint;
	telemetryService.publicLogError2<SingularityModelCallFailureEvent, SingularityModelCallFailureClassification>('agentHost.singularityModelCallFailure', {
		...correlation,
		sdkEventId: event.id,
		sdkParentEventId: event.parentId ?? undefined,
		sdkAgentId: event.agentId,
		failureKind: event.data.failureKind,
		source: event.data.source,
		transport: event.data.transport,
		apiEndpoint: event.data.apiEndpoint,
		statusCode: event.data.statusCode,
		durationMs: event.data.durationMs,
		model: event.data.isByok ? 'byokModel' : event.data.model,
		reasoningEffort: event.data.reasoningEffort,
		isAuto: event.data.isAuto,
		isByok: event.data.isByok,
		rte: event.data.rte,
		badRequestKind: event.data.badRequestKind,
		apiCallId: event.data.apiCallId,
		providerCallId: event.data.providerCallId,
		serviceRequestId: event.data.serviceRequestId,
		messageCount: fingerprint?.messageCount,
		toolCallCount: fingerprint?.toolCallCount,
		toolResultMessageCount: fingerprint?.toolResultMessageCount,
		namelessToolCallCount: fingerprint?.namelessToolCallCount,
		imagePartCount: fingerprint?.imagePartCount,
		imagePartsMissingMediaType: fingerprint?.imagePartsMissingMediaType,
	});
}
