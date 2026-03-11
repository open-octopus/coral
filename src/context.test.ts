import { describe, it, expect } from 'vitest';
import { WorkflowContext } from './context.js';
import type { StepDefinition, StepResult } from './types.js';

function makeStepDef(overrides: Partial<StepDefinition> & { id: string }): StepDefinition {
  return {
    action: 'test-action',
    ...overrides,
  };
}

function makeResult(stepId: string, overrides: Partial<StepResult> = {}): StepResult {
  return {
    stepId,
    status: 'done',
    result: `result-of-${stepId}`,
    startedAt: 1000,
    completedAt: 2000,
    ...overrides,
  };
}

describe('WorkflowContext', () => {
  describe('constructor', () => {
    it('builds stepDefs Map from StepDefinition array', () => {
      const defs: StepDefinition[] = [
        makeStepDef({ id: 'a', realm: 'pet', action: 'feed' }),
        makeStepDef({ id: 'b', realm: 'finance', action: 'budget' }),
        makeStepDef({ id: 'c', action: 'merge' }),
      ];

      const ctx = new WorkflowContext(defs);

      // Verify by using realm-based lookup (the only way to observe stepDefs indirectly)
      // Set results for all steps
      ctx.setStepResult('a', makeResult('a'));
      ctx.setStepResult('b', makeResult('b'));
      ctx.setStepResult('c', makeResult('c'));

      // realm lookups confirm the stepDefs were stored correctly
      expect(ctx.getRealmData('pet')).toHaveLength(1);
      expect(ctx.getRealmData('pet')[0].stepId).toBe('a');
      expect(ctx.getRealmData('finance')).toHaveLength(1);
      expect(ctx.getRealmData('finance')[0].stepId).toBe('b');
    });
  });

  describe('setStepResult / getStepResult', () => {
    it('round-trips a step result', () => {
      const ctx = new WorkflowContext([makeStepDef({ id: 's1' })]);
      const result = makeResult('s1', { result: { key: 'value' }, error: undefined });

      ctx.setStepResult('s1', result);

      const retrieved = ctx.getStepResult('s1');
      expect(retrieved).toBeDefined();
      expect(retrieved).toEqual(result);
    });

    it('returns undefined for unknown stepId', () => {
      const ctx = new WorkflowContext([]);
      expect(ctx.getStepResult('nonexistent')).toBeUndefined();
    });
  });

  describe('getRealmData', () => {
    it('returns matching realm results', () => {
      const defs = [
        makeStepDef({ id: 'a', realm: 'pet' }),
        makeStepDef({ id: 'b', realm: 'pet' }),
        makeStepDef({ id: 'c', realm: 'finance' }),
      ];
      const ctx = new WorkflowContext(defs);

      ctx.setStepResult('a', makeResult('a'));
      ctx.setStepResult('b', makeResult('b'));
      ctx.setStepResult('c', makeResult('c'));

      const petResults = ctx.getRealmData('pet');
      expect(petResults).toHaveLength(2);
      expect(petResults.map((r) => r.stepId).sort()).toEqual(['a', 'b']);

      const financeResults = ctx.getRealmData('finance');
      expect(financeResults).toHaveLength(1);
      expect(financeResults[0].stepId).toBe('c');
    });

    it('returns empty array when no realm matches', () => {
      const defs = [makeStepDef({ id: 'a', realm: 'pet' })];
      const ctx = new WorkflowContext(defs);
      ctx.setStepResult('a', makeResult('a'));

      expect(ctx.getRealmData('nonexistent')).toEqual([]);
    });

    it('returns empty array when definition matches but no results exist', () => {
      const defs = [
        makeStepDef({ id: 'a', realm: 'pet' }),
        makeStepDef({ id: 'b', realm: 'pet' }),
      ];
      const ctx = new WorkflowContext(defs);

      // No results set — definitions exist but results don't
      expect(ctx.getRealmData('pet')).toEqual([]);
    });
  });

  describe('getAllResults', () => {
    it('returns a Map copy of all results', () => {
      const ctx = new WorkflowContext([
        makeStepDef({ id: 'x' }),
        makeStepDef({ id: 'y' }),
      ]);

      const rx = makeResult('x');
      const ry = makeResult('y');
      ctx.setStepResult('x', rx);
      ctx.setStepResult('y', ry);

      const all = ctx.getAllResults();
      expect(all).toBeInstanceOf(Map);
      expect(all.size).toBe(2);
      expect(all.get('x')).toEqual(rx);
      expect(all.get('y')).toEqual(ry);

      // Verify it is a copy — mutating the returned map should not affect the context
      all.delete('x');
      expect(ctx.getStepResult('x')).toBeDefined();
    });
  });

  describe('interpolate', () => {
    it('replaces {{var}} placeholders with arg values', () => {
      const ctx = new WorkflowContext([]);
      const result = ctx.interpolate(
        'Going to {{destination}} for {{duration}}',
        { destination: 'Tokyo', duration: '5 days' },
      );
      expect(result).toBe('Going to Tokyo for 5 days');
    });

    it('preserves {{key}} when key is not in args', () => {
      const ctx = new WorkflowContext([]);
      const result = ctx.interpolate(
        'Hello {{name}}, welcome to {{place}}',
        { name: 'Alice' },
      );
      expect(result).toBe('Hello Alice, welcome to {{place}}');
    });
  });

  describe('interpolateParams', () => {
    it('returns empty object when params is undefined', () => {
      const ctx = new WorkflowContext([]);
      const result = ctx.interpolateParams(undefined, { key: 'val' });
      expect(result).toEqual({});
    });

    it('recursively processes all param values', () => {
      const ctx = new WorkflowContext([]);
      const result = ctx.interpolateParams(
        {
          dest: '{{destination}}',
          dur: '{{duration}}',
          literal: 'no-placeholder',
          mixed: 'Going to {{destination}} for {{duration}}',
        },
        { destination: 'Tokyo', duration: '5 days' },
      );

      expect(result).toEqual({
        dest: 'Tokyo',
        dur: '5 days',
        literal: 'no-placeholder',
        mixed: 'Going to Tokyo for 5 days',
      });
    });
  });
});
