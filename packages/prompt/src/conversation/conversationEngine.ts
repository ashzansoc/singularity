/**
 * Level 13 — Conversation Engine with structured rolling compression.
 */

import { estimateTokens, sha256, sha256Object } from '../hash.js';
import { compressConversation } from '../compression/semantic.js';
import type {
	ConversationEngine,
	ConversationState,
	ConversationTurnInput,
} from '../interfaces/index.js';
import type { GraphNode } from '../graph/types.js';
import { InMemoryContextGraph } from '../graph/contextGraph.js';

export interface StructuredConversationPackage {
	task: string;
	decisions: string[];
	currentState: string[];
	discoveries: string[];
	recentTurns: ConversationTurnInput[];
	text: string;
}

/** Build TASK / DECISIONS / CURRENT STATE / DISCOVERIES / RECENT package. */
export function buildStructuredConversationPackage(
	turns: ConversationTurnInput[],
	keepRecent = 5,
): StructuredConversationPackage {
	const recent = turns.slice(-keepRecent);
	const older = turns.slice(0, Math.max(0, turns.length - keepRecent));

	let task = '';
	const decisions: string[] = [];
	const currentState: string[] = [];
	const discoveries: string[] = [];

	for (const t of turns) {
		if (t.role === 'user' && !task) {
			task = t.content.slice(0, 240);
		}
		if (/decision|we'll use|prefer|don't modify|do not modify|chosen/i.test(t.content)) {
			decisions.push(t.content.replace(/\s+/g, ' ').trim().slice(0, 160));
		}
		if (/currently|stripped|unused|broken|fails|TODO|FIXME|state:/i.test(t.content)) {
			currentState.push(t.content.replace(/\s+/g, ' ').trim().slice(0, 160));
		}
		if (/discovered|found that|because|root cause|lives in|sends messages/i.test(t.content)) {
			discoveries.push(t.content.replace(/\s+/g, ' ').trim().slice(0, 160));
		}
	}

	if (!task && turns[0]) {
		task = turns[0].content.slice(0, 240);
	}

	// Fold older turns into state/discoveries extractively
	for (const t of older) {
		const preview = t.content.replace(/\s+/g, ' ').trim().slice(0, 120);
		if (t.role === 'assistant' && discoveries.length < 8) {
			discoveries.push(preview);
		} else if (currentState.length < 8) {
			currentState.push(preview);
		}
	}

	const text = [
		'TASK',
		'─'.repeat(20),
		task || '(unspecified)',
		'',
		'DECISIONS',
		'─'.repeat(20),
		...(decisions.slice(0, 8).map((d) => `• ${d}`) || ['• (none yet)']),
		'',
		'CURRENT STATE',
		'─'.repeat(20),
		...(currentState.slice(0, 8).map((d) => `• ${d}`) || ['• (none)']),
		'',
		'IMPORTANT DISCOVERIES',
		'─'.repeat(20),
		...(discoveries.slice(0, 8).map((d) => `• ${d}`) || ['• (none)']),
		'',
		'RECENT CONVERSATION',
		'─'.repeat(20),
		...recent.map((t) => `${t.role}: ${t.content.slice(0, 400)}`),
	].join('\n');

	return {
		task,
		decisions: decisions.slice(0, 8),
		currentState: currentState.slice(0, 8),
		discoveries: discoveries.slice(0, 8),
		recentTurns: recent,
		text,
	};
}

export class DefaultConversationEngine implements ConversationEngine {
	ingest(turns: ConversationTurnInput[]): ConversationState {
		const compressed = compressConversation(
			turns.map((t) => ({
				id: t.id,
				role: t.role,
				content: t.content,
				createdAt: t.createdAt,
			})),
			{ keepRecentTurns: 5 },
		);

		const pkg = buildStructuredConversationPackage(turns, 5);

		const importantFacts: string[] = [...pkg.decisions, ...pkg.discoveries].slice(0, 8);
		const resolvedTasks: string[] = [];
		const pendingTasks: string[] = [];
		for (const t of turns) {
			if (/TODO|FIXME|pending/i.test(t.content)) {
				pendingTasks.push(t.content.slice(0, 120));
			}
			if (/done|fixed|resolved|completed/i.test(t.content)) {
				resolvedTasks.push(t.content.slice(0, 120));
			}
			if (/remember|always|prefer|never/i.test(t.content)) {
				importantFacts.push(t.content.slice(0, 160));
			}
		}

		const conversationHash = sha256Object({
			recent: pkg.recentTurns.map((t) => t.id),
			summary: pkg.text.slice(0, 500),
		});

		return {
			recentTurns: pkg.recentTurns.map((t) => ({
				id: t.id,
				role: t.role as ConversationTurnInput['role'],
				content: t.content,
				createdAt: t.createdAt,
			})),
			summary: pkg.text,
			importantFacts: importantFacts.slice(0, 8),
			resolvedTasks: resolvedTasks.slice(0, 8),
			pendingTasks: pendingTasks.slice(0, 8),
			referencedMessageIds: compressed.droppedTurnIds.slice(0, 16),
			conversationHash,
		};
	}

	toNodes(state: ConversationState): GraphNode[] {
		const nodes: GraphNode[] = [];
		if (state.summary) {
			nodes.push(
				InMemoryContextGraph.makeNode({
					id: `summary:${sha256(state.summary).slice(0, 12)}`,
					kind: 'summary',
					label: 'conversation-package',
					content: state.summary,
				}),
			);
		}
		for (const t of state.recentTurns) {
			nodes.push(
				InMemoryContextGraph.makeNode({
					id: `conversation:${t.id}`,
					kind: 'conversation',
					label: `${t.role}:${t.id}`,
					content: `${t.role}: ${t.content}`,
					meta: { role: t.role, createdAt: t.createdAt },
				}),
			);
		}
		for (const fact of state.importantFacts) {
			nodes.push(
				InMemoryContextGraph.makeNode({
					id: `fact:${sha256(fact).slice(0, 12)}`,
					kind: 'memory',
					label: 'important-fact',
					content: fact,
					tokenCount: estimateTokens(fact),
				}),
			);
		}
		return nodes;
	}
}
