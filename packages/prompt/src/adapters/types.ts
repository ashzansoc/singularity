/** Provider families for Prompt IR rendering (L9). */
export type ProviderKind =
	| 'claude'
	| 'anthropic'
	| 'gpt'
	| 'openai'
	| 'azure'
	| 'gemini'
	| 'google'
	| 'qwen'
	| 'alibaba'
	| 'local'
	| 'ollama'
	| 'vllm'
	| 'lmstudio'
	| 'openrouter'
	| 'generic';

export function normalizeProviderKind(raw: string | undefined): ProviderKind {
	const v = (raw ?? 'generic').toLowerCase();
	if (v.includes('claude') || v.includes('anthropic')) {
		return 'claude';
	}
	if (v.includes('gpt') || v.includes('openai') || v.includes('o1') || v.includes('o3') || v.includes('o4')) {
		return 'gpt';
	}
	if (v.includes('gemini') || v.includes('google')) {
		return 'gemini';
	}
	if (v.includes('qwen') || v.includes('alibaba')) {
		return 'qwen';
	}
	if (v.includes('ollama')) {
		return 'ollama';
	}
	if (v.includes('vllm')) {
		return 'vllm';
	}
	if (v.includes('lmstudio') || v.includes('lm-studio')) {
		return 'lmstudio';
	}
	if (v.includes('local')) {
		return 'local';
	}
	if (v.includes('openrouter')) {
		return 'openrouter';
	}
	return 'generic';
}
