import type { BuiltContext, RepoIndexPort } from '../types.js';
import { appendVolatileContext } from '../builder/contextBuilder.js';

export interface ExpandContextInput {
  built: BuiltContext;
  index: RepoIndexPort;
  requestedFiles: string[];
  reason: string;
  maxFileChars?: number;
}

export function expandBuiltContext(input: ExpandContextInput): BuiltContext {
  const maxFileChars = input.maxFileChars ?? 8_000;
  const already = new Set(input.built.filesUsed);
  const added: string[] = [];
  const chunks: string[] = [
    `CONTEXT EXPANSION: ${input.reason}`,
  ];
  for (const path of input.requestedFiles) {
    if (already.has(path)) {
      continue;
    }
    const body = input.index.readFile(path);
    if (body === undefined) {
      chunks.push(`MISSING FILE ${path}`);
      continue;
    }
    added.push(path);
    chunks.push(`FILE ${path}\n${body.slice(0, maxFileChars)}`);
  }
  if (!added.length && chunks.length === 1) {
    return input.built;
  }
  return appendVolatileContext(input.built, chunks.join('\n\n'), added);
}

export function expandFromVerifierFailure(
  built: BuiltContext,
  index: RepoIndexPort,
  output: string,
): BuiltContext {
  const known = index.listFileMetadata().map((f) => f.path);
  const requested = pathsFromFailureOutput(output, known);
  if (!requested.length) {
    return built;
  }
  return expandBuiltContext({
    built,
    index,
    requestedFiles: requested,
    reason: `verifier failure: ${output.slice(0, 400)}`,
  });
}

/** Pull likely repo paths out of test/typecheck failure output. */
export function pathsFromFailureOutput(
  output: string,
  knownPaths: string[],
): string[] {
  const hits: string[] = [];
  for (const path of knownPaths) {
    if (output.includes(path) && !hits.includes(path)) {
      hits.push(path);
    }
  }
  const re = /(?:src|tests?|lib)\/[\w./-]+\.(?:tsx?|jsx?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(output))) {
    if (m[0] && knownPaths.includes(m[0]) && !hits.includes(m[0])) {
      hits.push(m[0]);
    }
  }
  return hits.slice(0, 8);
}
