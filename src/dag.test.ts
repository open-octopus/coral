import { describe, it, expect } from 'vitest';
import {
  buildDAG,
  topologicalSort,
  detectCycles,
  getReadySteps,
  validateDAG,
} from './dag.js';
import type { StepDefinition } from './types.js';

function makeSteps(
  defs: Array<{ id: string; depends_on?: string[] }>,
): StepDefinition[] {
  return defs.map((d) => ({
    id: d.id,
    action: 'test-action',
    depends_on: d.depends_on,
  }));
}

describe('buildDAG', () => {
  it('creates a DAG from steps with no dependencies', () => {
    const dag = buildDAG(makeSteps([{ id: 'a' }, { id: 'b' }, { id: 'c' }]));
    expect(dag.size).toBe(3);
    expect(dag.get('a')).toEqual([]);
    expect(dag.get('b')).toEqual([]);
    expect(dag.get('c')).toEqual([]);
  });

  it('creates a DAG with dependencies', () => {
    const dag = buildDAG(
      makeSteps([
        { id: 'a' },
        { id: 'b', depends_on: ['a'] },
        { id: 'c', depends_on: ['a', 'b'] },
      ]),
    );
    expect(dag.get('a')).toEqual([]);
    expect(dag.get('b')).toEqual(['a']);
    expect(dag.get('c')).toEqual(['a', 'b']);
  });
});

describe('topologicalSort', () => {
  it('sorts independent nodes alphabetically', () => {
    const dag = buildDAG(makeSteps([{ id: 'c' }, { id: 'a' }, { id: 'b' }]));
    const sorted = topologicalSort(dag);
    expect(sorted).toEqual(['a', 'b', 'c']);
  });

  it('sorts a linear chain', () => {
    const dag = buildDAG(
      makeSteps([
        { id: 'c', depends_on: ['b'] },
        { id: 'b', depends_on: ['a'] },
        { id: 'a' },
      ]),
    );
    const sorted = topologicalSort(dag);
    expect(sorted).toEqual(['a', 'b', 'c']);
  });

  it('sorts a diamond dependency', () => {
    const dag = buildDAG(
      makeSteps([
        { id: 'a' },
        { id: 'b', depends_on: ['a'] },
        { id: 'c', depends_on: ['a'] },
        { id: 'd', depends_on: ['b', 'c'] },
      ]),
    );
    const sorted = topologicalSort(dag);

    // 'a' must come first, 'd' must come last
    expect(sorted[0]).toBe('a');
    expect(sorted[sorted.length - 1]).toBe('d');
    // 'b' and 'c' come between (order may vary but both before 'd')
    expect(sorted.indexOf('b')).toBeLessThan(sorted.indexOf('d'));
    expect(sorted.indexOf('c')).toBeLessThan(sorted.indexOf('d'));
  });

  it('throws on a cycle', () => {
    const dag = buildDAG(
      makeSteps([
        { id: 'a', depends_on: ['b'] },
        { id: 'b', depends_on: ['a'] },
      ]),
    );
    expect(() => topologicalSort(dag)).toThrow('cycle');
  });

  it('handles a single node', () => {
    const dag = buildDAG(makeSteps([{ id: 'only' }]));
    expect(topologicalSort(dag)).toEqual(['only']);
  });
});

describe('detectCycles', () => {
  it('returns null for acyclic graph', () => {
    const dag = buildDAG(
      makeSteps([
        { id: 'a' },
        { id: 'b', depends_on: ['a'] },
        { id: 'c', depends_on: ['b'] },
      ]),
    );
    expect(detectCycles(dag)).toBeNull();
  });

  it('detects a simple two-node cycle', () => {
    const dag = buildDAG(
      makeSteps([
        { id: 'a', depends_on: ['b'] },
        { id: 'b', depends_on: ['a'] },
      ]),
    );
    const cycle = detectCycles(dag);
    expect(cycle).not.toBeNull();
    expect(cycle!.length).toBeGreaterThanOrEqual(2);
  });

  it('detects a three-node cycle', () => {
    const dag = buildDAG(
      makeSteps([
        { id: 'a', depends_on: ['c'] },
        { id: 'b', depends_on: ['a'] },
        { id: 'c', depends_on: ['b'] },
      ]),
    );
    const cycle = detectCycles(dag);
    expect(cycle).not.toBeNull();
  });

  it('returns null for independent nodes', () => {
    const dag = buildDAG(makeSteps([{ id: 'x' }, { id: 'y' }, { id: 'z' }]));
    expect(detectCycles(dag)).toBeNull();
  });

  it('returns null for empty DAG', () => {
    const dag = buildDAG([]);
    expect(detectCycles(dag)).toBeNull();
  });
});

describe('getReadySteps', () => {
  it('returns all root nodes when nothing is completed', () => {
    const dag = buildDAG(
      makeSteps([
        { id: 'a' },
        { id: 'b' },
        { id: 'c', depends_on: ['a', 'b'] },
      ]),
    );
    const ready = getReadySteps(dag, new Set());
    expect(ready).toEqual(['a', 'b']);
  });

  it('returns dependent node when all deps are completed', () => {
    const dag = buildDAG(
      makeSteps([
        { id: 'a' },
        { id: 'b' },
        { id: 'c', depends_on: ['a', 'b'] },
      ]),
    );
    const ready = getReadySteps(dag, new Set(['a', 'b']));
    expect(ready).toEqual(['c']);
  });

  it('does not return node when only some deps are completed', () => {
    const dag = buildDAG(
      makeSteps([
        { id: 'a' },
        { id: 'b' },
        { id: 'c', depends_on: ['a', 'b'] },
      ]),
    );
    const ready = getReadySteps(dag, new Set(['a']));
    expect(ready).toEqual(['b']);
  });

  it('excludes already completed and running nodes', () => {
    const dag = buildDAG(
      makeSteps([
        { id: 'a' },
        { id: 'b' },
        { id: 'c', depends_on: ['a'] },
      ]),
    );
    const ready = getReadySteps(dag, new Set(['a']), new Set(['b']));
    expect(ready).toEqual(['c']);
  });

  it('returns empty array when all nodes are completed', () => {
    const dag = buildDAG(makeSteps([{ id: 'a' }, { id: 'b' }]));
    const ready = getReadySteps(dag, new Set(['a', 'b']));
    expect(ready).toEqual([]);
  });
});

describe('validateDAG', () => {
  it('returns no errors for a valid DAG', () => {
    const errors = validateDAG(
      makeSteps([
        { id: 'a' },
        { id: 'b', depends_on: ['a'] },
        { id: 'c', depends_on: ['a', 'b'] },
      ]),
    );
    expect(errors).toEqual([]);
  });

  it('returns error for missing dependency reference', () => {
    const errors = validateDAG(
      makeSteps([
        { id: 'a' },
        { id: 'b', depends_on: ['nonexistent'] },
      ]),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('unknown step');
  });

  it('returns error for circular dependency', () => {
    const errors = validateDAG(
      makeSteps([
        { id: 'a', depends_on: ['b'] },
        { id: 'b', depends_on: ['a'] },
      ]),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Circular dependency');
  });

  it('returns no errors for empty steps', () => {
    const errors = validateDAG([]);
    expect(errors).toEqual([]);
  });
});
