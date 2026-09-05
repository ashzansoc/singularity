import { describe, expect, it } from 'vitest';
import {
  coerceFlashOrPro,
  decideFlashOrPro,
  FLASH_MODEL_ID,
} from '../src/nemotronFlashPro/index.js';

describe('Nemotron flash/pro router', () => {
  it('coerces noisy model text to flash or pro', () => {
    expect(coerceFlashOrPro('flash')).toBe('flash');
    expect(coerceFlashOrPro('<think>hmm</think>\npro')).toBe('pro');
    expect(coerceFlashOrPro('The answer is FLASH.')).toBe('flash');
  });

  it('always returns DeepSeek V4 Flash-0731 (Pro is disabled)', async () => {
    const d = await decideFlashOrPro('Investigate intermittent auth failures.');
    expect(d.choice).toBe('flash');
    expect(d.modelId).toBe(FLASH_MODEL_ID);
    expect(d.source).toBe('disabled');
  });
});
