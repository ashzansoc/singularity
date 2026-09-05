/**
 * Mirror of OpenRouter message shaping for unit tests (no network).
 */
export function buildProviderBodyMessages(
  messages: Array<{
    role: string;
    content: string;
    name?: string;
    cache_control?: { type: 'ephemeral' };
    providerExtras?: Record<string, unknown>;
  }>,
): unknown[] {
  return messages.map((m) => {
    const cacheControl =
      m.cache_control ??
      (m.providerExtras?.cache_control as { type: 'ephemeral' } | undefined);
    if (cacheControl && m.role === 'system') {
      return {
        role: m.role,
        content: [
          {
            type: 'text',
            text: m.content,
            cache_control: cacheControl,
          },
        ],
        ...(m.name ? { name: m.name } : {}),
      };
    }
    return {
      role: m.role,
      content: m.content,
      ...(m.name ? { name: m.name } : {}),
      ...(cacheControl ? { cache_control: cacheControl } : {}),
    };
  });
}
