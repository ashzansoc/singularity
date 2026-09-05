/**
 * @singularity/wiki — Singularity LLM Wiki (Karpathy pattern)
 */

export type * from './types.js';
export {
  readWikiEngineFlags,
  isWikiEngineActive,
  type WikiEngineFlags,
} from './flags.js';
export { redactSecrets } from './redact.js';
export { slugify, todayDate } from './slug.js';
export { parseFrontmatter, stringifyFrontmatter } from './frontmatter.js';
export { wikiPaths, pageRelPath, relToWorkspace, type WikiPaths } from './paths.js';
export { WikiStore } from './store.js';
export { searchPages, extractWikilinks, tokenize } from './search.js';
export { lintWiki } from './lint.js';
export { queryWiki } from './query.js';
export { ingestSource } from './ingest.js';
export { formatWikiContextBlock, formatLintReport } from './format.js';
export { WIKI_SCHEMA_MD } from './schema.js';
export {
  WikiEngine,
  createWikiEngine,
  type WikiEngineOptions,
} from './engine.js';
