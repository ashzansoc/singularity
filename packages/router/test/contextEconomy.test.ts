import { describe, expect, it } from 'vitest';
import { classifyTask } from '../src/taskClassifier.js';
import { buildProviderBodyMessages } from './helpers/providerBody.js';

describe('taskClassifier', () => {
  it('classifies locate vs implement', () => {
    expect(classifyTask('Where is the authentication middleware?').taskClass).toBe('locate');
    expect(classifyTask('Where is the authentication middleware?').preferTools).toBe(true);
    expect(classifyTask('Implement OAuth across the application').taskClass).toBe('implement');
    expect(classifyTask('Rename this variable').taskClass).toBe('edit_local');
    expect(classifyTask('Review this implementation').taskClass).toBe('review');
  });
});

describe('provider cache body', () => {
  it('attaches cache_control on system messages', () => {
    const body = buildProviderBodyMessages([
      {
        role: 'system',
        content: 'stable',
        cache_control: { type: 'ephemeral' },
      },
      { role: 'user', content: 'hi' },
    ]);
    const sys = body[0] as { content: unknown };
    expect(Array.isArray(sys.content)).toBe(true);
    expect((sys.content as Array<{ cache_control?: unknown }>)[0]?.cache_control).toEqual({
      type: 'ephemeral',
    });
  });
});
