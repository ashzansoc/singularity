/**
 * Language extractors — TS/JS/Python heuristic parsers (no full AST dependency).
 */

import type { LanguageExtractor } from '../interfaces/index.js';

export class TypeScriptExtractor implements LanguageExtractor {
	readonly languages = ['typescript', 'javascript', 'typescriptreact', 'javascriptreact'];

	extract(input: { uri: string; content: string; languageId?: string }) {
		const content = input.content;
		const symbols: ReturnType<LanguageExtractor['extract']>['symbols'] = [];
		const imports: ReturnType<LanguageExtractor['extract']>['imports'] = [];
		const exports: ReturnType<LanguageExtractor['extract']>['exports'] = [];
		const calls: Array<{ from: string; to: string }> = [];

		const lines = content.split('\n');
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]!;
			const fn =
				line.match(/^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/) ||
				line.match(/^\s*(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(/) ||
				line.match(/^\s*(?:public|private|protected)?\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*[:{]/);
			if (fn) {
				symbols.push({
					kind: 'function',
					name: fn[1]!,
					startLine: i + 1,
					content: line.trim(),
				});
			}
			const cls = line.match(/^\s*(?:export\s+)?class\s+(\w+)/);
			if (cls) {
				symbols.push({ kind: 'class', name: cls[1]!, startLine: i + 1, content: line.trim() });
			}
			const iface = line.match(/^\s*(?:export\s+)?interface\s+(\w+)/);
			if (iface) {
				symbols.push({
					kind: 'interface',
					name: iface[1]!,
					startLine: i + 1,
					content: line.trim(),
				});
			}
			const imp = line.match(/import\s+(?:type\s+)?(?:\{([^}]+)\}|\*\s+as\s+(\w+)|(\w+))\s+from\s+['"]([^'"]+)['"]/);
			if (imp) {
				const names = (imp[1] ?? imp[2] ?? imp[3] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
				for (const name of names) {
					imports.push({ name: name.replace(/^type\s+/, ''), from: imp[4]! });
				}
			}
			const exp = line.match(/export\s+(?:default\s+)?(?:function|class|const|interface|type)\s+(\w+)/);
			if (exp) {
				exports.push({ name: exp[1]! });
			}
			const call = line.match(/(\w+)\s*\(/);
			if (call && symbols.length) {
				calls.push({ from: symbols[symbols.length - 1]!.name, to: call[1]! });
			}
		}

		return { symbols, imports, exports, calls };
	}
}

export class PythonExtractor implements LanguageExtractor {
	readonly languages = ['python'];

	extract(input: { uri: string; content: string }) {
		const symbols: ReturnType<LanguageExtractor['extract']>['symbols'] = [];
		const imports: ReturnType<LanguageExtractor['extract']>['imports'] = [];
		const exports: ReturnType<LanguageExtractor['extract']>['exports'] = [];
		const lines = input.content.split('\n');
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]!;
			const fn = line.match(/^\s*def\s+(\w+)/);
			if (fn) {
				symbols.push({ kind: 'function', name: fn[1]!, startLine: i + 1, content: line.trim() });
				exports.push({ name: fn[1]! });
			}
			const cls = line.match(/^\s*class\s+(\w+)/);
			if (cls) {
				symbols.push({ kind: 'class', name: cls[1]!, startLine: i + 1, content: line.trim() });
				exports.push({ name: cls[1]! });
			}
			const imp = line.match(/^\s*(?:from\s+(\S+)\s+)?import\s+(.+)/);
			if (imp) {
				const from = imp[1] ?? '';
				for (const part of imp[2]!.split(',')) {
					const name = part.trim().split(/\s+as\s+/)[0]!.trim();
					if (name) {
						imports.push({ name, from });
					}
				}
			}
		}
		return { symbols, imports, exports };
	}
}

export function defaultExtractors(): LanguageExtractor[] {
	return [new TypeScriptExtractor(), new PythonExtractor()];
}

export function pickExtractor(
	extractors: LanguageExtractor[],
	languageId?: string,
): LanguageExtractor | undefined {
	if (!languageId) {
		return extractors[0];
	}
	return extractors.find((e) => e.languages.includes(languageId)) ?? extractors[0];
}
