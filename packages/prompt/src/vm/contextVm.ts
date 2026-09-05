/**
 * Level 11 — Context Virtual Machine
 */

import { segmentsForIntent, normalizePromptIntent } from '../routing/packs.js';
import type {
	ContextGraph,
	ContextVM,
	RetrievalHit,
	VmInstruction,
	VmProgram,
	VmWorkingSet,
} from '../interfaces/index.js';
import type { PromptIntent } from '../types.js';

const KIND_TO_LOAD: Record<string, string> = {
	system: 'system',
	userPrompt: 'userPrompt',
	selection: 'selection',
	currentFile: 'file',
	repository: 'repository',
	retrieval: 'function',
	diagnostics: 'diagnostic',
	terminal: 'terminal',
	conversation: 'conversation',
	memory: 'memory',
	agent: 'agent',
};

export class DefaultContextVM implements ContextVM {
	buildProgram(intent: PromptIntent | string, retrieved: RetrievalHit[]): VmProgram {
		const normalized = normalizePromptIntent(String(intent));
		const segments = segmentsForIntent(normalized);
		const instructions: VmInstruction[] = [];

		instructions.push({ op: 'LOAD_SUMMARY', arg: 'repository' });

		for (const seg of segments) {
			const kind = KIND_TO_LOAD[seg] ?? seg;
			if (seg === 'userPrompt') {
				instructions.push({ op: 'LOAD', arg: 'userPrompt' });
				continue;
			}
			if (seg === 'system') {
				instructions.push({ op: 'LOAD', arg: 'system' });
				continue;
			}
			const nodeIds = retrieved
				.filter((h) => h.nodeId.includes(`:${kind}:`) || h.reason.includes(seg) || h.nodeId.startsWith(`${kind}:`) || h.nodeId.startsWith('file:') && seg === 'currentFile')
				.slice(0, 12)
				.map((h) => h.nodeId);
			if (nodeIds.length) {
				instructions.push({ op: 'LOAD_NODE', arg: seg, nodeIds });
				// Expand symbol neighbors (callers/deps) after loading hits
				const symbolIds = nodeIds.filter((id) =>
					/:(function|class|interface|symbol):/.test(id),
				);
				if (symbolIds.length) {
					instructions.push({
						op: 'LOAD_NEIGHBORS',
						arg: 'deps',
						nodeIds: symbolIds,
						limit: 4,
					});
				}
			} else {
				instructions.push({ op: 'LOAD', arg: kind, limit: 8 });
			}
		}

		instructions.push({ op: 'COMPRESS', arg: 'conversation' });
		instructions.push({ op: 'BUDGET_SLICE' });
		instructions.push({ op: 'EMIT_BLOCK', arg: 'system' });
		instructions.push({ op: 'EMIT_BLOCK', arg: 'retrieval' });
		instructions.push({ op: 'EMIT_BLOCK', arg: 'conversation' });
		instructions.push({ op: 'EMIT_BLOCK', arg: 'user' });

		return { intent: normalized, instructions };
	}

	execute(program: VmProgram, graph: ContextGraph): VmWorkingSet {
		const loaded = new Set<string>();
		const compressedIds: string[] = [];
		const emittedBlocks: VmWorkingSet['emittedBlocks'] = [];

		for (const insn of program.instructions) {
			switch (insn.op) {
				case 'LOAD':
				case 'LOAD_SUMMARY': {
					const kind = insn.arg ?? 'file';
					const nodes = graph.listNodes(kind as never).slice(0, insn.limit ?? 16);
					for (const n of nodes) {
						loaded.add(n.id);
					}
					break;
				}
				case 'LOAD_NODE': {
					for (const id of insn.nodeIds ?? []) {
						if (graph.getNode(id)) {
							loaded.add(id);
						}
					}
					break;
				}
				case 'LOAD_NEIGHBORS': {
					for (const id of insn.nodeIds ?? [...loaded]) {
						for (const n of graph.neighbors(id).slice(0, insn.limit ?? 4)) {
							loaded.add(n.id);
						}
					}
					break;
				}
				case 'COMPRESS': {
					for (const id of loaded) {
						const n = graph.getNode(id);
						if (n?.kind === 'conversation' || n?.kind === 'summary') {
							compressedIds.push(id);
						}
					}
					break;
				}
				case 'BUDGET_SLICE':
					break;
				case 'EMIT_BLOCK': {
					const role = insn.arg ?? 'context';
					const nodeIds = [...loaded].filter((id) => {
						const n = graph.getNode(id);
						if (!n) {
							return false;
						}
						if (role === 'system') {
							return n.kind === 'system' || n.kind === 'repository';
						}
						if (role === 'retrieval') {
							return ['file', 'function', 'class', 'interface', 'symbol', 'diagnostic', 'git', 'memory'].includes(n.kind);
						}
						if (role === 'conversation') {
							return n.kind === 'conversation' || n.kind === 'summary';
						}
						if (role === 'user') {
							return n.kind === 'userPrompt' || n.kind === 'selection';
						}
						return true;
					});
					emittedBlocks.push({ role, nodeIds });
					break;
				}
			}
		}

		return {
			nodeIds: [...loaded],
			emittedBlocks,
			compressedIds,
		};
	}
}
