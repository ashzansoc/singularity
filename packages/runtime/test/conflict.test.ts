import { describe, expect, it } from 'vitest';
import { detectRecommendationConflicts } from '../src/conflict/resolver.js';
import type { SubagentResult } from '../src/subagent/types.js';

describe('ConflictResolver', () => {
  it('detects contradictory Redis recommendations', () => {
    const results: SubagentResult[] = [
      {
        subagentId: 'a1',
        status: 'success',
        summary: 'Use Redis',
        filesCreated: [],
        filesModified: [],
        issues: [],
        recommendations: ['Use Redis for session cache'],
        artifacts: [],
      },
      {
        subagentId: 'a2',
        status: 'success',
        summary: 'Avoid Redis',
        filesCreated: [],
        filesModified: [],
        issues: [],
        recommendations: ['Do not introduce Redis dependency'],
        artifacts: [],
      },
    ];
    const conflicts = detectRecommendationConflicts(results);
    expect(conflicts.length).toBeGreaterThan(0);
  });
});
