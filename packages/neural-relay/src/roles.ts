import {
  DEFAULT_CODING_MODEL,
  DEFAULT_NEURAL_RELAY_MODEL,
  type NeuralRelayFlags,
} from './flags.js';
import type { ModelRole, ModelRoleBinding } from './types.js';

export function roleBinding(
  role: ModelRole,
  flags: NeuralRelayFlags,
): ModelRoleBinding {
  switch (role) {
    case 'CONTEXT_INTELLIGENCE':
      return {
        role,
        provider: 'openrouter',
        model: flags.model || DEFAULT_NEURAL_RELAY_MODEL,
      };
    case 'CODING':
      return {
        role,
        provider: 'openrouter',
        model: flags.codingModel || DEFAULT_CODING_MODEL,
      };
    case 'REASONING':
      return {
        role,
        provider: 'openrouter',
        model: flags.codingModel || DEFAULT_CODING_MODEL,
      };
    case 'VERIFICATION':
      return {
        role,
        provider: 'openrouter',
        model: flags.codingModel || DEFAULT_CODING_MODEL,
      };
  }
}
