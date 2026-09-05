/**
 * Prompt Engine v2 — shared graph node / edge types.
 */

export type NodeKind =
	| 'repository'
	| 'folder'
	| 'file'
	| 'class'
	| 'function'
	| 'method'
	| 'interface'
	| 'import'
	| 'export'
	| 'reference'
	| 'symbol'
	| 'variable'
	| 'diagnostic'
	| 'terminal'
	| 'conversation'
	| 'memory'
	| 'agent'
	| 'git'
	| 'selection'
	| 'userPrompt'
	| 'system'
	| 'summary'
	| 'document'
	| 'adr'
	| 'test'
	| 'api'
	| 'requirement';

export type EdgeKind =
	| 'contains'
	| 'imports'
	| 'exports'
	| 'calls'
	| 'references'
	| 'diagnoses'
	| 'related_to'
	| 'summarizes'
	| 'depends_on'
	| 'implements'
	| 'extends'
	| 'tested_by'
	| 'defined_in'
	| 'affects'
	| 'documented_by';

export type MemoryScope =
	| 'session'
	| 'project'
	| 'repository'
	| 'user'
	| 'agent'
	| 'failure'
	| 'benchmark'
	| 'preference';

export interface GraphNode {
	id: string;
	kind: NodeKind;
	/** Display / path / symbol name. */
	label: string;
	/** Optional body text (file content, memory text, etc.). */
	content?: string;
	hash: string;
	version: number;
	tokenCount: number;
	embedding?: number[];
	dependencies: string[];
	lastModified: number;
	/** Opaque metadata (uri, line, severity, scope, …). */
	meta?: Record<string, unknown>;
}

export interface GraphEdge {
	id: string;
	from: string;
	to: string;
	kind: EdgeKind;
	weight?: number;
}

export interface MemoryNode extends GraphNode {
	kind: 'memory';
	scope: MemoryScope;
	priority: number;
	importance: number;
	ttl?: number;
	tags: string[];
	lastUsed: number;
}

export const IR_VERSION = 3 as const;
