/**
 * Level 2 — Incremental Context Builder
 * Only refresh changed files / slices; never rebuild the whole repository.
 */

import { hashContent } from '../hash.js';
import {
	type CanonicalContext,
	type DiagnosticItem,
	type FileContextSlice,
	type MemoryItem,
	type PromptIntent,
	type RetrievalHit,
	type TerminalSnippet,
	createEmptyCanonicalContext,
} from '../types.js';

export interface FileSnapshot {
	uri: string;
	content: string;
	version: number;
	languageId?: string;
	/** Optional precomputed AST / symbol digests — opaque to the prompt layer. */
	astHash?: string;
	symbolsHash?: string;
	embeddingHash?: string;
}

export interface IncrementalBuilderState {
	sessionId: string;
	/** uri → last ingested snapshot */
	files: Map<string, FileSnapshot>;
	/** Dependency edge digests keyed by uri. */
	deps: Map<string, string>;
	dirtyUris: Set<string>;
	context: CanonicalContext;
}

export interface BuilderUpdate {
	intent?: PromptIntent;
	systemPrompt?: string;
	userPrompt?: string;
	selection?: CanonicalContext['selection'];
	currentFileUri?: string;
	/** Upsert file contents; only these are marked dirty. */
	files?: FileSnapshot[];
	/** Remove files no longer open / relevant. */
	removeUris?: string[];
	repositorySummary?: string;
	branch?: string;
	workspaceId?: string;
	dependencyEdges?: Array<{ from: string; to: string }>;
	retrieval?: RetrievalHit[];
	diagnostics?: DiagnosticItem[];
	terminal?: TerminalSnippet[];
	memories?: MemoryItem[];
	agent?: CanonicalContext['agent'];
	preferences?: CanonicalContext['preferences'];
	conversation?: CanonicalContext['conversation'];
	conversationSummary?: string;
}

export function createIncrementalBuilder(sessionId: string, workspaceId = 'default'): IncrementalBuilderState {
	return {
		sessionId,
		files: new Map(),
		deps: new Map(),
		dirtyUris: new Set(),
		context: createEmptyCanonicalContext(sessionId, {
			repository: { workspaceId, files: [] },
		}),
	};
}

/**
 * Apply a partial update. Unchanged files keep prior content / digests.
 */
export function applyBuilderUpdate(
	state: IncrementalBuilderState,
	update: BuilderUpdate,
): IncrementalBuilderState {
	const files = new Map(state.files);
	const deps = new Map(state.deps);
	const dirtyUris = new Set<string>();

	for (const uri of update.removeUris ?? []) {
		files.delete(uri);
		deps.delete(uri);
		dirtyUris.add(uri);
	}

	for (const snap of update.files ?? []) {
		const prev = files.get(snap.uri);
		const contentHash = hashContent(snap.content);
		const prevHash = prev ? hashContent(prev.content) : '';
		const changed =
			!prev ||
			prev.version !== snap.version ||
			prevHash !== contentHash ||
			prev.astHash !== snap.astHash ||
			prev.symbolsHash !== snap.symbolsHash ||
			prev.embeddingHash !== snap.embeddingHash;
		if (changed) {
			files.set(snap.uri, snap);
			dirtyUris.add(snap.uri);
		}
	}

	if (update.dependencyEdges) {
		for (const edge of update.dependencyEdges) {
			const key = edge.from;
			const digest = hashContent(`${edge.from}->${edge.to}`);
			if (deps.get(key) !== digest) {
				deps.set(key, digest);
				dirtyUris.add(key);
			}
		}
	}

	const repoFiles: FileContextSlice[] = [...files.values()].map((f) => ({
		uri: f.uri,
		content: f.content,
		version: f.version,
		languageId: f.languageId,
	}));

	const dependencyGraph = update.dependencyEdges
		? update.dependencyEdges.map((e) => `${e.from} -> ${e.to}`).join('\n')
		: state.context.repository.dependencyGraph;

	const currentFile =
		update.currentFileUri && files.has(update.currentFileUri)
			? {
					uri: update.currentFileUri,
					content: files.get(update.currentFileUri)!.content,
					version: files.get(update.currentFileUri)!.version,
					languageId: files.get(update.currentFileUri)!.languageId,
				}
			: update.currentFileUri === undefined
				? state.context.currentFile
				: undefined;

	const context: CanonicalContext = {
		...state.context,
		updatedAt: Date.now(),
		intent: update.intent ?? state.context.intent,
		systemPrompt: update.systemPrompt ?? state.context.systemPrompt,
		userPrompt: update.userPrompt ?? state.context.userPrompt,
		selection: update.selection !== undefined ? update.selection : state.context.selection,
		currentFile,
		conversation: update.conversation ?? state.context.conversation,
		conversationSummary:
			update.conversationSummary !== undefined
				? update.conversationSummary
				: state.context.conversationSummary,
		repository: {
			...state.context.repository,
			workspaceId: update.workspaceId ?? state.context.repository.workspaceId,
			branch: update.branch ?? state.context.repository.branch,
			summary: update.repositorySummary ?? state.context.repository.summary,
			files: repoFiles,
			dependencyGraph,
			depsVersion: hashContent([...deps.entries()].sort().join('|')),
		},
		retrieval: update.retrieval ?? state.context.retrieval,
		diagnostics: update.diagnostics ?? state.context.diagnostics,
		terminal: update.terminal ?? state.context.terminal,
		memories: update.memories ?? state.context.memories,
		agent: update.agent ?? state.context.agent,
		preferences: update.preferences ?? state.context.preferences,
	};

	return {
		sessionId: state.sessionId,
		files,
		deps,
		dirtyUris,
		context,
	};
}

/** True when the builder would need to recompute AST/symbols/embeddings for uri. */
export function isFileDirty(state: IncrementalBuilderState, uri: string): boolean {
	return state.dirtyUris.has(uri);
}

export function listDirtyUris(state: IncrementalBuilderState): string[] {
	return [...state.dirtyUris];
}

/** Clear dirty flags after AST/symbol/embedding workers finish. */
export function clearDirtyFlags(state: IncrementalBuilderState, uris?: string[]): IncrementalBuilderState {
	const dirtyUris = new Set(state.dirtyUris);
	if (!uris) {
		dirtyUris.clear();
	} else {
		for (const u of uris) {
			dirtyUris.delete(u);
		}
	}
	return { ...state, dirtyUris };
}
