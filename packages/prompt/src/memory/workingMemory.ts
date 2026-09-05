/**
 * Working memory (ephemeral session) vs project memory (durable).
 * Repository knowledge lives in the Repo Map — not here.
 */

import { estimateTokens, sha256 } from '../hash.js';
import type { MemoryNode, MemoryScope } from '../graph/types.js';

export interface WorkingMemoryState {
	sessionId: string;
	currentTask?: string;
	currentFiles: string[];
	currentErrors: string[];
	currentPlan?: string;
	lastToolResults: Array<{ tool: string; summary: string; at: number }>;
	currentDiff?: string;
	updatedAt: number;
}

export class WorkingMemory {
	private state: WorkingMemoryState;

	constructor(sessionId: string) {
		this.state = {
			sessionId,
			currentFiles: [],
			currentErrors: [],
			lastToolResults: [],
			updatedAt: Date.now(),
		};
	}

	get(): WorkingMemoryState {
		return { ...this.state, currentFiles: [...this.state.currentFiles], currentErrors: [...this.state.currentErrors], lastToolResults: [...this.state.lastToolResults] };
	}

	update(patch: Partial<Omit<WorkingMemoryState, 'sessionId'>>): void {
		this.state = {
			...this.state,
			...patch,
			sessionId: this.state.sessionId,
			updatedAt: Date.now(),
		};
	}

	recordToolResult(tool: string, summary: string): void {
		this.state.lastToolResults = [
			...this.state.lastToolResults.slice(-7),
			{ tool, summary: summary.slice(0, 2_000), at: Date.now() },
		];
		this.state.updatedAt = Date.now();
	}

	/** Render a compact working-memory package for the prompt. */
	render(maxTokens = 1_500): string {
		const s = this.state;
		const parts = [
			'WORKING MEMORY',
			'─'.repeat(20),
			s.currentTask ? `Current task: ${s.currentTask}` : '',
			s.currentPlan ? `Plan: ${s.currentPlan}` : '',
			s.currentFiles.length ? `Files: ${s.currentFiles.slice(0, 12).join(', ')}` : '',
			s.currentErrors.length ? `Errors:\n${s.currentErrors.slice(0, 8).map((e) => `• ${e}`).join('\n')}` : '',
			s.currentDiff ? `Diff:\n${s.currentDiff.slice(0, 3_000)}` : '',
			s.lastToolResults.length
				? `Tool results:\n${s.lastToolResults
						.slice(-4)
						.map((t) => `• [${t.tool}] ${t.summary.slice(0, 240)}`)
						.join('\n')}`
				: '',
		].filter(Boolean);
		let text = parts.join('\n');
		while (estimateTokens(text) > maxTokens && text.length > 200) {
			text = text.slice(0, Math.floor(text.length * 0.85)) + '\n…';
		}
		return text;
	}

	toMemoryNode(): MemoryNode {
		const content = this.render();
		return {
			id: `working:${this.state.sessionId}`,
			kind: 'memory',
			label: 'working-memory',
			content,
			scope: 'session',
			priority: 2,
			importance: 0.9,
			hash: sha256(content),
			version: 1,
			tokenCount: estimateTokens(content),
			dependencies: [],
			lastModified: this.state.updatedAt,
			lastUsed: Date.now(),
			tags: ['working'],
		};
	}
}

export interface ProjectMemoryEntry {
	id: string;
	kind:
		| 'architecture'
		| 'api'
		| 'preference'
		| 'convention'
		| 'bug'
		| 'approach'
		| 'other';
	text: string;
	updatedAt: number;
}

/** Durable project-level facts (preferences, conventions, known bugs, …). */
export class ProjectMemoryStore {
	private readonly entries = new Map<string, ProjectMemoryEntry>();

	upsert(entry: ProjectMemoryEntry): void {
		this.entries.set(entry.id, entry);
	}

	remove(id: string): void {
		this.entries.delete(id);
	}

	list(): ProjectMemoryEntry[] {
		return [...this.entries.values()].sort((a, b) => b.updatedAt - a.updatedAt);
	}

	render(maxTokens = 1_200): string {
		const lines = ['PROJECT MEMORY', '─'.repeat(20)];
		for (const e of this.list().slice(0, 24)) {
			lines.push(`• [${e.kind}] ${e.text.slice(0, 240)}`);
			if (estimateTokens(lines.join('\n')) > maxTokens) {
				lines.push('• …');
				break;
			}
		}
		return lines.join('\n');
	}

	toMemoryNodes(scope: MemoryScope = 'project'): MemoryNode[] {
		return this.list().map((e) => ({
			id: `project:${e.id}`,
			kind: 'memory' as const,
			label: e.kind,
			content: e.text,
			scope,
			priority: 5,
			importance: 0.7,
			hash: sha256(e.text),
			version: 1,
			tokenCount: estimateTokens(e.text),
			dependencies: [],
			lastModified: e.updatedAt,
			lastUsed: Date.now(),
			tags: [e.kind, 'project'],
		}));
	}
}
