/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cross-cutting chat turn status so long Automode / Design Intelligence work
 * can update the visible "Thinking" UI even when those layers do not hold the
 * ChatResponseStream.
 *
 * Bind once at the start of a chat request; report from routers / directors.
 * Thinking titles use `**Title**` so ChatThinkingContentPart extracts them.
 */

export interface ChatTurnStatusUpdate {
	/** Short label shown as the Thinking header (e.g. "Design Director"). */
	title: string;
	/** Optional one-line detail under the title. */
	detail?: string;
}

type ChatTurnStatusListener = (update: ChatTurnStatusUpdate) => void;

let listener: ChatTurnStatusListener | undefined;
let lastKey = '';
let lastAt = 0;

/** Whether a chat stream is currently listening for status updates. */
export function isChatTurnStatusBound(): boolean {
	return typeof listener === 'function';
}

/** Bind the active chat stream reporter. Returns an unbind function. */
export function bindChatTurnStatus(report: ChatTurnStatusListener): () => void {
	const previous = listener;
	listener = report;
	lastKey = '';
	lastAt = 0;
	return () => {
		if (listener === report) {
			listener = previous;
		}
		lastKey = '';
		lastAt = 0;
	};
}

/**
 * Engines run on the background agent. Do not surface them on the main
 * chat thinking stream — the user only waits when a blocking tool is required.
 */
export function reportEngineCalled(_engineName: string, _detail = 'called'): void {
	return;
}

/**
 * Report user-visible turn progress. Dedupes identical messages within 400ms
 * so hot loops do not spam the stream.
 */
export function reportChatTurnStatus(title: string, detail?: string): void {
	const key = `${title}\0${detail ?? ''}`;
	const now = Date.now();
	if (key === lastKey && now - lastAt < 400) {
		return;
	}
	lastKey = key;
	lastAt = now;
	try {
		listener?.({ title, detail });
	} catch {
		/* stream may already be closed */
	}
}

/** Heartbeat while a long await is in flight (Design Spec LLM, etc.). */
export function startChatTurnStatusHeartbeat(
	title: string,
	baseDetail: string,
	intervalMs = 4_000,
): () => void {
	const started = Date.now();
	reportChatTurnStatus(title, baseDetail);
	const timer = setInterval(() => {
		const secs = Math.max(1, Math.round((Date.now() - started) / 1000));
		reportChatTurnStatus(title, `${baseDetail} (${secs}s)`);
	}, intervalMs);
	return () => {
		clearInterval(timer);
	};
}

/** Report a checklist phase on the bound thinking stream (and optional progress line). */
export function reportChecklistPhase(
	stream: { progress?: (value: string) => void } | undefined,
	title: string,
	detail?: string,
): void {
	reportChatTurnStatus(title, detail);
	try {
		stream?.progress?.(detail ? `${title}: ${detail}` : title);
	} catch {
		/* stream may already be closed */
	}
}
