export interface ProjectSnapshot {
  project: {
    name: string;
    language: string[];
    frameworks: string[];
    databases: string[];
    infrastructure: string[];
  };
  architecture: string[];
  constraints: string[];
  prompt_block: string;
}

export function emptySnapshot(name = 'project'): ProjectSnapshot {
  return {
    project: {
      name,
      language: [],
      frameworks: [],
      databases: [],
      infrastructure: [],
    },
    architecture: [],
    constraints: [],
    prompt_block: '',
  };
}
