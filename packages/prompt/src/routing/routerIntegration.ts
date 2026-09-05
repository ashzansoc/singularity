/**
 * Level 10 — Router integration (IR metadata only; no model selection)
 */

import type { PromptIR } from '../ir/types.js';
import type { RouteMetadata, RouterIntegration } from '../interfaces/index.js';

export class DefaultRouterIntegration implements RouterIntegration {
	prepare(ir: PromptIR): RouteMetadata {
		const text = ir.blocks.map((b) => b.text).join('\n');
		const requiresTools = /\btool\b|function call|MCP/i.test(text) ||
			ir.blocks.some((b) => b.role === 'tool');
		const hasImages = ir.blocks.some((b) => /data:image|\.png|\.jpg|image\//i.test(b.text));
		let complexity: RouteMetadata['complexity'] = 'low';
		if (ir.totalTokens > 6000 || ir.intent === 'ARCHITECTURE' || ir.intent === 'DEBUG') {
			complexity = 'high';
		} else if (ir.totalTokens > 2000 || ir.intent === 'EDIT' || ir.intent === 'AGENT') {
			complexity = 'medium';
		}
		return {
			intent: ir.intent,
			estimatedTokens: ir.totalTokens,
			requiresTools,
			hasImages,
			complexity,
			irHash: ir.irHash,
			blockCount: ir.blocks.length,
		};
	}
}
