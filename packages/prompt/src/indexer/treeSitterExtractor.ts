/**
 * Symbol Extraction
 *
 *                    Symbol Extraction
 *                           │
 *                    ┌──────┴──────┐
 *                    │             │
 *             Tree-sitter      Fallback
 *               PRIMARY        SECONDARY (optional)
 *                    │             │
 *                    └──────┬──────┘
 *                           ▼
 *                  Unified Symbol Graph
 *
 * Tree-sitter (web-tree-sitter + WASM grammars) is the primary structural
 * parser. Structural/regex fallback runs only when explicitly allowed and
 * Tree-sitter is unavailable or fails for a file.
 */

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { LanguageExtractor } from '../interfaces/index.js';
import {
	TypeScriptExtractor as RegexTypeScriptExtractor,
	PythonExtractor as RegexPythonExtractor,
} from './extractors.js';

export type SymbolKind = 'function' | 'class' | 'interface' | 'symbol';

export interface ExtractedSymbol {
	kind: SymbolKind;
	name: string;
	startLine?: number;
	endLine?: number;
	content?: string;
}

export interface ExtractResult {
	symbols: ExtractedSymbol[];
	imports: Array<{ name: string; from: string }>;
	exports: Array<{ name: string }>;
	calls: Array<{ from: string; to: string }>;
}

export type ExtractorBackend = 'tree-sitter' | 'structural-fallback' | 'regex-fallback' | 'unavailable';

export interface TreeSitterInitOptions {
	/** Injected Parser (tests / custom hosts). */
	Parser?: TreeSitterParserCtor;
	Language?: { load(wasmPath: string | Uint8Array): Promise<unknown> };
	/** Absolute paths to grammar WASM files. */
	wasmPaths?: {
		typescript?: string;
		tsx?: string;
		javascript?: string;
		python?: string;
	};
	/**
	 * When true (default), structural/regex may run if Tree-sitter is not ready
	 * or fails. Set false to require Tree-sitter only.
	 */
	allowFallback?: boolean;
}

type TreeSitterParserCtor = new () => {
	setLanguage(lang: unknown): void;
	parse(input: string): { rootNode: TreeSitterNode };
};

type TreeSitterParser = {
	parse(input: string): { rootNode: TreeSitterNode };
};

type TreeSitterNode = {
	type: string;
	text: string;
	startPosition: { row: number; column: number };
	endPosition: { row: number; column: number };
	namedChildren: TreeSitterNode[];
	childForFieldName?(name: string): TreeSitterNode | null;
};

let sharedTsParser: TreeSitterParser | undefined;
let sharedTsxParser: TreeSitterParser | undefined;
let sharedJsParser: TreeSitterParser | undefined;
let sharedPyParser: TreeSitterParser | undefined;
let initPromise: Promise<boolean> | undefined;
let allowFallbackGlobal = true;
let lastInitError: string | undefined;
let initFailed = false;
let cachedRequire: ReturnType<typeof createRequire> | undefined;

/**
 * createRequire(import.meta.url) breaks when esbuild bundles to CJS (import.meta → {}).
 * Resolve lazily with fallbacks so the host extension can still activate.
 */
function nodeRequire(): ReturnType<typeof createRequire> {
	if (cachedRequire) {
		return cachedRequire;
	}
	const candidates: string[] = [];
	try {
		const metaUrl = import.meta.url;
		if (typeof metaUrl === 'string' && metaUrl.length > 0) {
			candidates.push(metaUrl);
		}
	} catch {
		/* import.meta unavailable */
	}
	// Fallbacks when bundled into singularity-ai (or similar) without import.meta.url
	for (const root of [
		process.cwd(),
		path.resolve(process.cwd(), '..'),
		path.resolve(process.cwd(), '../..'),
		path.resolve(process.cwd(), 'packages/prompt'),
		path.resolve(process.cwd(), 'vscode/extensions/singularity-ai'),
	]) {
		candidates.push(path.join(root, 'package.json'));
	}
	for (const candidate of candidates) {
		try {
			cachedRequire = createRequire(candidate);
			return cachedRequire;
		} catch {
			/* try next */
		}
	}
	throw new Error('Unable to create Node require() for Tree-sitter WASM resolution');
}

function resolveWasmsRoot(): string | undefined {
	try {
		return path.dirname(nodeRequire().resolve('tree-sitter-wasms/package.json'));
	} catch {
		try {
			// Fallback: resolve any file under the package if package.json is not exported
			const entry = nodeRequire().resolve('tree-sitter-wasms');
			return path.dirname(entry);
		} catch {
			return undefined;
		}
	}
}

function resolveWebTreeSitterDir(): string | undefined {
	try {
		return path.dirname(nodeRequire().resolve('web-tree-sitter'));
	} catch {
		return undefined;
	}
}

/** Runtime WASM for Parser.init — missing in a broken web-tree-sitter install. */
function resolveRuntimeWasm(): string | undefined {
	const pkgDir = resolveWebTreeSitterDir();
	if (!pkgDir) {
		return undefined;
	}
	for (const candidate of [
		path.join(pkgDir, 'tree-sitter.wasm'),
		path.join(pkgDir, 'lib', 'tree-sitter.wasm'),
		path.join(pkgDir, 'debug', 'tree-sitter.wasm'),
	]) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	return undefined;
}

function defaultWasmPath(name: string): string | undefined {
	const root = resolveWasmsRoot();
	if (!root) {
		return undefined;
	}
	return path.join(root, 'out', name);
}

/** Whether Tree-sitter parsers are loaded and ready. */
export function isTreeSitterReady(): boolean {
	return Boolean(sharedTsParser || sharedTsxParser || sharedJsParser || sharedPyParser);
}

export function getTreeSitterInitError(): string | undefined {
	return lastInitError;
}

export function setAllowFallback(allow: boolean): void {
	allowFallbackGlobal = allow;
}

export function getAllowFallback(): boolean {
	return allowFallbackGlobal;
}

/**
 * Initialize Tree-sitter as the primary symbol parser.
 * Safe to call multiple times; concurrent callers share one promise.
 */
export async function initTreeSitter(options: TreeSitterInitOptions = {}): Promise<boolean> {
	if (options.allowFallback !== undefined) {
		allowFallbackGlobal = options.allowFallback;
	}
	if (isTreeSitterReady()) {
		return true;
	}
	if (initFailed) {
		return false;
	}
	if (!initPromise) {
		initPromise = doInitTreeSitter(options);
	}
	return initPromise;
}

/** Alias — call before indexing so Tree-sitter is primary. */
export const ensureTreeSitterReady = initTreeSitter;

async function doInitTreeSitter(options: TreeSitterInitOptions): Promise<boolean> {
	lastInitError = undefined;
	try {
		let ParserCtor = options.Parser;
		let LanguageLoad = options.Language?.load;

		if (!ParserCtor || !LanguageLoad) {
			const inElectron = Boolean(process.versions?.electron);
			const runtimeWasm = resolveRuntimeWasm();
			// Extension Host cannot instantiate this WASM (LinkError: env.abort).
			// Skip and use structural/regex fallback instead of retrying per file.
			if (inElectron) {
				lastInitError = 'tree-sitter WASM skipped in Electron extension host';
				initFailed = true;
				return false;
			}
			if (!runtimeWasm) {
				lastInitError = 'web-tree-sitter runtime WASM is not installed';
				initFailed = true;
				return false;
			}
			const mod = await import('web-tree-sitter');
			const Parser = (mod as { Parser: TreeSitterParserCtor & { init: (opts?: unknown) => Promise<void> } }).Parser;
			const Language = (mod as { Language: { load: (p: string | Uint8Array) => Promise<unknown> } }).Language;
			await Parser.init({
				locateFile: () => runtimeWasm,
			} as never);
			ParserCtor = Parser;
			LanguageLoad = Language.load.bind(Language);
		}

		const paths = {
			typescript:
				options.wasmPaths?.typescript ?? defaultWasmPath('tree-sitter-typescript.wasm'),
			tsx: options.wasmPaths?.tsx ?? defaultWasmPath('tree-sitter-tsx.wasm'),
			javascript:
				options.wasmPaths?.javascript ?? defaultWasmPath('tree-sitter-javascript.wasm'),
			python: options.wasmPaths?.python ?? defaultWasmPath('tree-sitter-python.wasm'),
		};

		if (paths.typescript) {
			const lang = await LanguageLoad!(paths.typescript);
			const p = new ParserCtor!();
			p.setLanguage(lang);
			sharedTsParser = p;
		}
		if (paths.tsx) {
			try {
				const lang = await LanguageLoad!(paths.tsx);
				const p = new ParserCtor!();
				p.setLanguage(lang);
				sharedTsxParser = p;
			} catch {
				sharedTsxParser = sharedTsParser;
			}
		}
		if (paths.javascript) {
			try {
				const lang = await LanguageLoad!(paths.javascript);
				const p = new ParserCtor!();
				p.setLanguage(lang);
				sharedJsParser = p;
			} catch {
				sharedJsParser = sharedTsParser;
			}
		}
		if (paths.python) {
			const lang = await LanguageLoad!(paths.python);
			const p = new ParserCtor!();
			p.setLanguage(lang);
			sharedPyParser = p;
		}

		const ready = isTreeSitterReady();
		if (!ready) {
			initFailed = true;
		}
		return ready;
	} catch (err) {
		lastInitError = err instanceof Error ? err.message : String(err);
		initFailed = true;
		return false;
	}
}

export function setTreeSitterParsers(parsers: {
	typescript?: TreeSitterParser;
	tsx?: TreeSitterParser;
	javascript?: TreeSitterParser;
	python?: TreeSitterParser;
}): void {
	if (parsers.typescript) {
		sharedTsParser = parsers.typescript;
	}
	if (parsers.tsx) {
		sharedTsxParser = parsers.tsx;
	}
	if (parsers.javascript) {
		sharedJsParser = parsers.javascript;
	}
	if (parsers.python) {
		sharedPyParser = parsers.python;
	}
}

function pickTsParser(languageId?: string): TreeSitterParser | undefined {
	const id = languageId ?? 'typescript';
	if (id === 'typescriptreact' || id === 'tsx') {
		return sharedTsxParser ?? sharedTsParser;
	}
	if (id === 'javascript' || id === 'javascriptreact' || id === 'jsx') {
		return sharedJsParser ?? sharedTsParser;
	}
	return sharedTsParser ?? sharedTsxParser ?? sharedJsParser;
}

function extractFromTsTree(root: TreeSitterNode): ExtractResult {
	const symbols: ExtractedSymbol[] = [];
	const imports: Array<{ name: string; from: string }> = [];
	const exports: Array<{ name: string }> = [];
	const calls: Array<{ from: string; to: string }> = [];

	const visit = (node: TreeSitterNode, enclosing?: string) => {
		const t = node.type;
		if (
			t === 'function_declaration' ||
			t === 'method_definition' ||
			t === 'generator_function_declaration'
		) {
			const nameNode =
				node.childForFieldName?.('name') ??
				node.namedChildren.find(
					(c) => c.type === 'identifier' || c.type === 'property_identifier',
				);
			const name = nameNode?.text ?? 'anonymous';
			symbols.push({
				kind: 'function',
				name,
				startLine: node.startPosition.row + 1,
				endLine: node.endPosition.row + 1,
				content: node.text.slice(0, 12_000),
			});
			for (const child of node.namedChildren) {
				visit(child, name);
			}
			return;
		}
		if (t === 'class_declaration') {
			const nameNode =
				node.childForFieldName?.('name') ??
				node.namedChildren.find(
					(c) => c.type === 'type_identifier' || c.type === 'identifier',
				);
			const name = nameNode?.text ?? 'AnonymousClass';
			symbols.push({
				kind: 'class',
				name,
				startLine: node.startPosition.row + 1,
				endLine: node.endPosition.row + 1,
				content: node.text.slice(0, 12_000),
			});
			exports.push({ name });
			for (const child of node.namedChildren) {
				visit(child, name);
			}
			return;
		}
		if (t === 'interface_declaration') {
			const nameNode =
				node.childForFieldName?.('name') ??
				node.namedChildren.find((c) => c.type === 'type_identifier');
			const name = nameNode?.text ?? 'AnonymousInterface';
			symbols.push({
				kind: 'interface',
				name,
				startLine: node.startPosition.row + 1,
				endLine: node.endPosition.row + 1,
				content: node.text.slice(0, 8_000),
			});
			exports.push({ name });
			return;
		}
		if (t === 'type_alias_declaration') {
			const nameNode =
				node.childForFieldName?.('name') ??
				node.namedChildren.find((c) => c.type === 'type_identifier');
			if (nameNode) {
				symbols.push({
					kind: 'symbol',
					name: nameNode.text,
					startLine: node.startPosition.row + 1,
					endLine: node.endPosition.row + 1,
					content: node.text.slice(0, 4_000),
				});
			}
			return;
		}
		if (t === 'lexical_declaration' || t === 'variable_declaration') {
			// const foo = () => {} / const foo = function() {}
			for (const decl of node.namedChildren.filter((c) => c.type === 'variable_declarator')) {
				const nameNode = decl.childForFieldName?.('name') ?? decl.namedChildren[0];
				const value =
					decl.childForFieldName?.('value') ??
					decl.namedChildren.find(
						(c) =>
							c.type === 'arrow_function' ||
							c.type === 'function' ||
							c.type === 'function_expression',
					);
				if (nameNode && value) {
					symbols.push({
						kind: 'function',
						name: nameNode.text,
						startLine: node.startPosition.row + 1,
						endLine: node.endPosition.row + 1,
						content: node.text.slice(0, 12_000),
					});
				}
			}
		}
		if (t === 'import_statement') {
			const text = node.text;
			const m = text.match(/from\s+['"]([^'"]+)['"]/);
			const from = m?.[1] ?? '';
			const brace = text.match(/\{([^}]+)\}/);
			if (brace && from) {
				for (const part of brace[1]!.split(',')) {
					const name = part.trim().split(/\s+as\s+/).pop()?.trim();
					if (name) {
						imports.push({ name, from });
					}
				}
			} else {
				const def = text.match(/import\s+(?:type\s+)?(\w+)/);
				if (def && from) {
					imports.push({ name: def[1]!, from });
				}
			}
		}
		if (t === 'export_statement') {
			const decl = node.namedChildren.find((c) =>
				['function_declaration', 'class_declaration', 'interface_declaration', 'lexical_declaration'].includes(
					c.type,
				),
			);
			if (decl) {
				visit(decl, enclosing);
				const name = decl.childForFieldName?.('name')?.text;
				if (name) {
					exports.push({ name });
				}
			} else {
				const name = node.namedChildren.find(
					(c) => c.type === 'identifier' || c.type === 'type_identifier',
				);
				if (name) {
					exports.push({ name: name.text });
				}
			}
			return;
		}
		if (t === 'call_expression' && enclosing) {
			const callee = node.namedChildren[0];
			if (callee) {
				calls.push({ from: enclosing, to: callee.text.split('.').pop()! });
			}
		}
		for (const child of node.namedChildren) {
			visit(child, enclosing);
		}
	};

	visit(root);
	return { symbols, imports, exports, calls };
}

function extractFromPyTree(root: TreeSitterNode): ExtractResult {
	const symbols: ExtractedSymbol[] = [];
	const imports: Array<{ name: string; from: string }> = [];
	const exports: Array<{ name: string }> = [];
	const calls: Array<{ from: string; to: string }> = [];

	const visit = (node: TreeSitterNode, enclosing?: string) => {
		const t = node.type;
		if (t === 'function_definition') {
			const nameNode =
				node.childForFieldName?.('name') ??
				node.namedChildren.find((c) => c.type === 'identifier');
			const name = nameNode?.text ?? 'anonymous';
			symbols.push({
				kind: 'function',
				name,
				startLine: node.startPosition.row + 1,
				endLine: node.endPosition.row + 1,
				content: node.text.slice(0, 12_000),
			});
			exports.push({ name });
			for (const child of node.namedChildren) {
				visit(child, name);
			}
			return;
		}
		if (t === 'class_definition') {
			const nameNode =
				node.childForFieldName?.('name') ??
				node.namedChildren.find((c) => c.type === 'identifier');
			const name = nameNode?.text ?? 'AnonymousClass';
			symbols.push({
				kind: 'class',
				name,
				startLine: node.startPosition.row + 1,
				endLine: node.endPosition.row + 1,
				content: node.text.slice(0, 12_000),
			});
			exports.push({ name });
			for (const child of node.namedChildren) {
				visit(child, name);
			}
			return;
		}
		if (t === 'import_statement' || t === 'import_from_statement') {
			const text = node.text;
			const fromM = text.match(/from\s+(\S+)\s+import\s+(.+)/);
			if (fromM) {
				for (const part of fromM[2]!.split(',')) {
					const name = part.trim().split(/\s+as\s+/)[0]!.trim();
					if (name && name !== '(' && name !== ')') {
						imports.push({ name: name.replace(/[()]/g, ''), from: fromM[1]! });
					}
				}
			} else {
				const imp = text.match(/import\s+(\S+)/);
				if (imp) {
					imports.push({ name: imp[1]!.split('.')[0]!, from: imp[1]! });
				}
			}
		}
		if (t === 'call' && enclosing) {
			const callee = node.namedChildren[0];
			if (callee) {
				calls.push({ from: enclosing, to: callee.text.split('.').pop()! });
			}
		}
		for (const child of node.namedChildren) {
			visit(child, enclosing);
		}
	};

	visit(root);
	return { symbols, imports, exports, calls };
}

/** Optional secondary: brace-aware structural extractor (not primary). */
export function structuralExtractTypeScript(content: string): ExtractResult {
	const symbols: ExtractedSymbol[] = [];
	const imports: Array<{ name: string; from: string }> = [];
	const exports: Array<{ name: string }> = [];
	const calls: Array<{ from: string; to: string }> = [];
	const lines = content.split('\n');

	const sliceBody = (startIdx: number): { text: string; endLine: number } => {
		let i = startIdx;
		let depth = 0;
		let started = false;
		const out: string[] = [];
		for (; i < lines.length; i++) {
			const line = lines[i]!;
			out.push(line);
			for (const ch of line) {
				if (ch === '{') {
					depth++;
					started = true;
				} else if (ch === '}') {
					depth--;
				}
			}
			if (started && depth <= 0) {
				break;
			}
			if (!started && /;\s*$/.test(line) && i > startIdx) {
				break;
			}
		}
		return { text: out.join('\n').slice(0, 12_000), endLine: i + 1 };
	};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		const fn =
			line.match(/^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/) ||
			line.match(
				/^\s*(?:export\s+)?(?:public|private|protected|static|async|\s)*(\w+)\s*\([^)]*\)\s*[:{]/,
			) ||
			line.match(/^\s*(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[^=])\s*=>/);
		if (fn) {
			const body = sliceBody(i);
			symbols.push({
				kind: 'function',
				name: fn[1]!,
				startLine: i + 1,
				endLine: body.endLine,
				content: body.text,
			});
			if (/^\s*export\b/.test(line)) {
				exports.push({ name: fn[1]! });
			}
			for (const m of body.text.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
				if (m[1] !== fn[1]) {
					calls.push({ from: fn[1]!, to: m[1]! });
				}
			}
			i = Math.max(i, body.endLine - 1);
			continue;
		}
		const cls = line.match(/^\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/);
		if (cls) {
			const body = sliceBody(i);
			symbols.push({
				kind: 'class',
				name: cls[1]!,
				startLine: i + 1,
				endLine: body.endLine,
				content: body.text,
			});
			exports.push({ name: cls[1]! });
			i = Math.max(i, body.endLine - 1);
			continue;
		}
		const iface = line.match(/^\s*(?:export\s+)?interface\s+(\w+)/);
		if (iface) {
			const body = sliceBody(i);
			symbols.push({
				kind: 'interface',
				name: iface[1]!,
				startLine: i + 1,
				endLine: body.endLine,
				content: body.text,
			});
			exports.push({ name: iface[1]! });
			i = Math.max(i, body.endLine - 1);
			continue;
		}
		const imp = line.match(
			/import\s+(?:type\s+)?(?:\{([^}]+)\}|\*\s+as\s+(\w+)|(\w+))\s+from\s+['"]([^'"]+)['"]/,
		);
		if (imp) {
			const names = (imp[1] ?? imp[2] ?? imp[3] ?? '')
				.split(',')
				.map((s) => s.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()!)
				.filter(Boolean);
			for (const name of names) {
				imports.push({ name, from: imp[4]! });
			}
		}
	}

	return { symbols, imports, exports, calls };
}

/** Optional secondary Python structural extractor. */
export function structuralExtractPython(content: string): ExtractResult {
	const symbols: ExtractedSymbol[] = [];
	const imports: Array<{ name: string; from: string }> = [];
	const exports: Array<{ name: string }> = [];
	const calls: Array<{ from: string; to: string }> = [];
	const lines = content.split('\n');
	const indentOf = (s: string) => s.match(/^\s*/)?.[0].length ?? 0;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		const fn = line.match(/^(\s*)(?:async\s+)?def\s+(\w+)\s*\(/);
		const cls = line.match(/^(\s*)class\s+(\w+)/);
		if (fn || cls) {
			const indent = indentOf(line);
			const name = (fn ?? cls)![2]!;
			const kind: SymbolKind = fn ? 'function' : 'class';
			let j = i + 1;
			while (j < lines.length) {
				const l = lines[j]!;
				if (l.trim() === '') {
					j++;
					continue;
				}
				if (indentOf(l) <= indent && l.trim()) {
					break;
				}
				j++;
			}
			const body = lines.slice(i, j).join('\n').slice(0, 12_000);
			symbols.push({ kind, name, startLine: i + 1, endLine: j, content: body });
			exports.push({ name });
			i = j - 1;
			continue;
		}
		const impFrom = line.match(/^\s*from\s+(\S+)\s+import\s+(.+)/);
		if (impFrom) {
			for (const part of impFrom[2]!.split(',')) {
				const name = part.trim().split(/\s+as\s+/)[0]!.trim();
				if (name) {
					imports.push({ name, from: impFrom[1]! });
				}
			}
		}
	}

	return { symbols, imports, exports, calls };
}

function runOptionalFallback(
	input: { uri: string; content: string; languageId?: string },
	kind: 'typescript' | 'python',
): ExtractResult | undefined {
	if (!allowFallbackGlobal) {
		return undefined;
	}
	if (kind === 'typescript') {
		const structural = structuralExtractTypeScript(input.content);
		if (structural.symbols.length > 0) {
			return structural;
		}
		const fb = new RegexTypeScriptExtractor().extract(input);
		return {
			symbols: fb.symbols.map((s) => ({
				kind: s.kind as SymbolKind,
				name: s.name,
				startLine: s.startLine,
				endLine: s.endLine,
				content: s.content,
			})),
			imports: fb.imports,
			exports: fb.exports,
			calls: fb.calls ?? [],
		};
	}
	const structural = structuralExtractPython(input.content);
	if (structural.symbols.length > 0) {
		return structural;
	}
	const fb = new RegexPythonExtractor().extract(input);
	return {
		symbols: fb.symbols.map((s) => ({
			kind: s.kind as SymbolKind,
			name: s.name,
			startLine: s.startLine,
			endLine: s.endLine,
			content: s.content,
		})),
		imports: fb.imports,
		exports: fb.exports,
		calls: [],
	};
}

export class TreeSitterTypeScriptExtractor implements LanguageExtractor {
	readonly languages = ['typescript', 'javascript', 'typescriptreact', 'javascriptreact'];
	lastBackend: ExtractorBackend = 'unavailable';

	extract(input: { uri: string; content: string; languageId?: string }): ExtractResult {
		const parser = pickTsParser(input.languageId);
		if (parser) {
			try {
				const tree = parser.parse(input.content);
				this.lastBackend = 'tree-sitter';
				return extractFromTsTree(tree.rootNode);
			} catch {
				// Tree-sitter failed for this file — optional fallback below
			}
		}
		const fb = runOptionalFallback(input, 'typescript');
		if (fb) {
			this.lastBackend = fb.symbols[0]?.content?.includes('{')
				? 'structural-fallback'
				: 'regex-fallback';
			return fb;
		}
		this.lastBackend = 'unavailable';
		return { symbols: [], imports: [], exports: [], calls: [] };
	}
}

export class TreeSitterPythonExtractor implements LanguageExtractor {
	readonly languages = ['python'];
	lastBackend: ExtractorBackend = 'unavailable';

	extract(input: { uri: string; content: string; languageId?: string }): ExtractResult {
		if (sharedPyParser) {
			try {
				const tree = sharedPyParser.parse(input.content);
				this.lastBackend = 'tree-sitter';
				return extractFromPyTree(tree.rootNode);
			} catch {
				// fall through to optional secondary
			}
		}
		const fb = runOptionalFallback(input, 'python');
		if (fb) {
			this.lastBackend = 'structural-fallback';
			return fb;
		}
		this.lastBackend = 'unavailable';
		return { symbols: [], imports: [], exports: [], calls: [] };
	}
}

/** Primary extractors — Tree-sitter first. */
export function treeSitterExtractors(): LanguageExtractor[] {
	return [new TreeSitterTypeScriptExtractor(), new TreeSitterPythonExtractor()];
}

export function fallbackExtractors(): LanguageExtractor[] {
	return [new RegexTypeScriptExtractor(), new RegexPythonExtractor()];
}
