import { describe, expect, it } from 'vitest';
import { createFallbackPlan } from '../src/planner/planner.js';

describe('createFallbackPlan', () => {
  it('fans notes app goals into parallel page tasks', () => {
    const plan = createFallbackPlan({
      goal: `# Runtime v4 Parallel Execution Test
Build a small Notes application using React + TypeScript + TailwindCSS.
Dashboard page, Notes page CRUD, Categories, Settings, Dark/Light theme,
Search bar, sidebar, toast, React Router, Zustand, reusable UI components.`,
    });

    const ids = plan.nodes.map((n) => n.id);
    expect(ids).toContain('scaffold');
    expect(ids).toContain('store');
    expect(ids).toContain('ui');
    expect(ids).toContain('dashboard');
    expect(ids).toContain('notes');
    expect(ids).toContain('categories');
    expect(ids).toContain('settings');
    expect(ids).toContain('integrate');

    // Pages should be parallelizable vs each other (same deps, no cross-deps)
    const notes = plan.nodes.find((n) => n.id === 'notes')!;
    const dash = plan.nodes.find((n) => n.id === 'dashboard')!;
    expect(notes.deps).not.toContain('dashboard');
    expect(dash.deps).not.toContain('notes');
    expect(plan.nodes.length).toBeGreaterThanOrEqual(6);
  });

  it('builds parallel backend/frontend DAG for health-check goals', () => {
    const plan = createFallbackPlan({
      goal: `Build a small health-check app in this workspace.
Deliverables: backend/ Node + Express GET /health, frontend/ static page, README.md`,
    });

    const ids = plan.nodes.map((n) => n.id);
    expect(ids).toEqual(['setup', 'backend', 'frontend', 'integrate']);

    const backend = plan.nodes.find((n) => n.id === 'backend')!;
    const frontend = plan.nodes.find((n) => n.id === 'frontend')!;
    expect(backend.deps).toEqual(['setup']);
    expect(frontend.deps).toEqual(['setup']);
    expect(backend.deps).not.toContain('frontend');
    expect(frontend.deps).not.toContain('backend');
  });
});
