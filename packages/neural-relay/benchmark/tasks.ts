export type BenchmarkCategory =
  | 'search'
  | 'auth'
  | 'api'
  | 'database'
  | 'frontend'
  | 'backend'
  | 'refactor'
  | 'bugfix'
  | 'tests'
  | 'cross-module'
  | 'architecture';

export type BenchmarkDifficulty = 'simple' | 'medium' | 'complex';

export interface BenchmarkTask {
  id: string;
  prompt: string;
  difficulty: BenchmarkDifficulty;
  category: BenchmarkCategory;
  expectedFiles: string[];
}

const ACCEPTANCE: BenchmarkTask = {
  id: 'oauth-apple-signin',
  difficulty: 'complex',
  category: 'auth',
  expectedFiles: [
    'src/auth/AuthProvider.ts',
    'src/auth/google.ts',
    'src/auth/authMiddleware.ts',
    'tests/auth.test.ts',
  ],
  prompt:
    'Find the Google OAuth implementation and replace it with Apple Sign-In while preserving the existing authentication architecture, routing behavior, error handling and tests.',
};

const TEMPLATES: Array<{
  category: BenchmarkCategory;
  difficulty: BenchmarkDifficulty;
  prompt: string;
  expectedFiles: string[];
}> = [
  { category: 'search', difficulty: 'simple', prompt: 'Locate the Google OAuth client id constant.', expectedFiles: ['src/auth/google.ts'] },
  { category: 'search', difficulty: 'simple', prompt: 'Find AuthProvider and list its exported functions.', expectedFiles: ['src/auth/AuthProvider.ts'] },
  { category: 'search', difficulty: 'simple', prompt: 'Where is the OAuth callback path defined?', expectedFiles: ['src/config.ts', 'src/auth/authMiddleware.ts'] },
  { category: 'auth', difficulty: 'simple', prompt: 'Add a comment documenting signInWithGoogle.', expectedFiles: ['src/auth/google.ts'] },
  { category: 'auth', difficulty: 'medium', prompt: 'Extract OAuth provider name into a shared type used by AuthProvider and google.ts.', expectedFiles: ['src/auth/AuthProvider.ts', 'src/auth/google.ts'] },
  { category: 'api', difficulty: 'simple', prompt: 'Add GET /api/health that returns {ok:true}.', expectedFiles: ['src/api/router.ts'] },
  { category: 'api', difficulty: 'medium', prompt: 'Validate email on createUser and reject empty strings.', expectedFiles: ['src/api/users.ts'] },
  { category: 'api', difficulty: 'complex', prompt: 'Add pagination to listUsers and thread it through handleApi.', expectedFiles: ['src/api/users.ts', 'src/api/router.ts'] },
  { category: 'database', difficulty: 'simple', prompt: 'Add created_at column to the users schema.', expectedFiles: ['src/db/schema.ts'] },
  { category: 'database', difficulty: 'medium', prompt: 'Add an oauth_accounts table linked to users.', expectedFiles: ['src/db/schema.ts'] },
  { category: 'database', difficulty: 'complex', prompt: 'Migrate provider default from google to apple in schema and document it.', expectedFiles: ['src/db/schema.ts', 'README.md'] },
  { category: 'frontend', difficulty: 'simple', prompt: 'Change LoginPage title to Sign in.', expectedFiles: ['src/ui/LoginPage.ts'] },
  { category: 'frontend', difficulty: 'medium', prompt: 'Show the current OAuth provider name on LoginPage.', expectedFiles: ['src/ui/LoginPage.ts', 'src/config.ts'] },
  { category: 'frontend', difficulty: 'complex', prompt: 'Add an Apple sign-in button next to Google on LoginPage wired to AuthProvider.', expectedFiles: ['src/ui/LoginPage.ts', 'src/auth/AuthProvider.ts'] },
  { category: 'backend', difficulty: 'simple', prompt: 'Return 404 from handleApi for unknown paths using a typed error.', expectedFiles: ['src/api/router.ts'] },
  { category: 'backend', difficulty: 'medium', prompt: 'Protect /api/users with authMiddleware.', expectedFiles: ['src/api/router.ts', 'src/auth/authMiddleware.ts'] },
  { category: 'backend', difficulty: 'complex', prompt: 'Add session token issuance after OAuth callback and store provider on the user.', expectedFiles: ['src/auth/authMiddleware.ts', 'src/api/users.ts'] },
  { category: 'refactor', difficulty: 'medium', prompt: 'Rename googleOAuthCallback to oauthCallback without changing behavior.', expectedFiles: ['src/auth/google.ts', 'src/auth/authMiddleware.ts'] },
  { category: 'refactor', difficulty: 'complex', prompt: 'Split AuthProvider login/logout into a strategy interface.', expectedFiles: ['src/auth/AuthProvider.ts'] },
  { category: 'bugfix', difficulty: 'simple', prompt: 'authMiddleware should not throw on non-callback paths with empty query.', expectedFiles: ['src/auth/authMiddleware.ts'] },
  { category: 'bugfix', difficulty: 'medium', prompt: 'googleOAuthCallback throws on empty code; return {ok:false} instead while tests still cover the error path.', expectedFiles: ['src/auth/google.ts', 'tests/auth.test.ts'] },
  { category: 'tests', difficulty: 'simple', prompt: 'Add a test that AppRouter exposes /login.', expectedFiles: ['src/routes/AppRouter.ts'] },
  { category: 'tests', difficulty: 'medium', prompt: 'Extend auth tests to cover logout.', expectedFiles: ['tests/auth.test.ts', 'src/auth/AuthProvider.ts'] },
  { category: 'tests', difficulty: 'complex', prompt: 'Add tests for Apple Sign-In once implemented, preserving Google coverage.', expectedFiles: ['tests/auth.test.ts'] },
  { category: 'cross-module', difficulty: 'medium', prompt: 'Pass oauth provider from config into LoginPage and AuthProvider.', expectedFiles: ['src/config.ts', 'src/ui/LoginPage.ts', 'src/auth/AuthProvider.ts'] },
  { category: 'cross-module', difficulty: 'complex', prompt: 'Wire Apple Sign-In through config, AuthProvider, middleware, schema, and tests.', expectedFiles: ['src/config.ts', 'src/auth/AuthProvider.ts', 'src/auth/authMiddleware.ts', 'src/db/schema.ts', 'tests/auth.test.ts'] },
  { category: 'architecture', difficulty: 'medium', prompt: 'Document the authentication architecture in README without changing code behavior.', expectedFiles: ['README.md'] },
  { category: 'architecture', difficulty: 'complex', prompt: 'Introduce an AuthAdapter interface and keep Google as the default adapter.', expectedFiles: ['src/auth/AuthProvider.ts', 'src/auth/google.ts'] },
];

function pad(n: number): string {
  return String(n).padStart(3, '0');
}

/**
 * 100 coding tasks: 30 simple / 40 medium / 30 complex.
 */
export function buildBenchmarkTasks(): BenchmarkTask[] {
  const tasks: BenchmarkTask[] = [ACCEPTANCE];
  const buckets: Record<BenchmarkDifficulty, BenchmarkTask[]> = {
    simple: [],
    medium: [],
    complex: [ACCEPTANCE],
  };

  let i = 1;
  const take = (difficulty: BenchmarkDifficulty, count: number) => {
    const pool = TEMPLATES.filter((t) => t.difficulty === difficulty);
    let n = 0;
    while (n < count) {
      const t = pool[n % pool.length]!;
      const variant = Math.floor(n / pool.length);
      const id = `t${pad(i)}-${t.category}-${difficulty}`;
      const prompt =
        variant === 0
          ? t.prompt
          : `${t.prompt} (variant ${variant + 1}: keep public APIs stable.)`;
      const task: BenchmarkTask = {
        id,
        prompt,
        difficulty,
        category: t.category,
        expectedFiles: t.expectedFiles,
      };
      tasks.push(task);
      buckets[difficulty].push(task);
      i += 1;
      n += 1;
    }
  };

  take('simple', 30);
  take('medium', 40);
  take('complex', 29); // plus ACCEPTANCE = 30

  return tasks;
}

export const BENCHMARK_TASKS = buildBenchmarkTasks();
