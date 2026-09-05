import { describe, expect, it, beforeEach } from 'vitest';
import {
  clearSpecialtyMemo,
  getSpecialtyMemo,
  setSpecialtyMemo,
  specialtyMemoKey,
} from '../src/specialtyMemo.js';
import type { SpecialtyClassification } from '../src/specialtyClassifier.js';

function llmClassification(specialty = 'general'): SpecialtyClassification {
  return {
    specialty: specialty as SpecialtyClassification['specialty'],
    confidence: 0.9,
    reason: 'test',
    source: 'llm',
    latencyMs: 12,
  };
}

describe('specialty memo', () => {
  beforeEach(() => {
    clearSpecialtyMemo();
  });

  it('stores and retrieves by normalized prompt bucket', () => {
    const k1 = specialtyMemoKey('Fix the login bug   in auth.ts');
    const k2 = specialtyMemoKey('fix the login bug in auth.ts');
    setSpecialtyMemo(k1, llmClassification());
    expect(getSpecialtyMemo(k2)).toBeDefined();
  });

  it('returns distinct keys for different prompts', () => {
    const a = specialtyMemoKey('add dark mode');
    const b = specialtyMemoKey('write unit tests');
    expect(a).not.toBe(b);
  });

  it('only memoizes LLM-sourced classifications', () => {
    const key = specialtyMemoKey('some prompt');
    setSpecialtyMemo(key, { ...llmClassification(), source: 'rules' });
    expect(getSpecialtyMemo(key)).toBeUndefined();
  });
});
