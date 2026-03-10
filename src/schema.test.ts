import { describe, it, expect } from 'vitest';
import {
  WorkflowDefinitionSchema,
  StepDefinitionSchema,
  validateWorkflow,
  validateDependencyReferences,
  validateUniqueStepIds,
} from './schema.js';

describe('StepDefinitionSchema', () => {
  it('accepts a minimal step', () => {
    const result = StepDefinitionSchema.safeParse({
      id: 'step-1',
      action: 'do-thing',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a full step', () => {
    const result = StepDefinitionSchema.safeParse({
      id: 'step-1',
      realm: 'pet',
      action: 'arrange-care',
      params: { duration: '5 days' },
      depends_on: ['step-0'],
      approval: 'required',
      timeout: 30000,
      retry: { max: 3, delay: 1000 },
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty id', () => {
    const result = StepDefinitionSchema.safeParse({
      id: '',
      action: 'do-thing',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty action', () => {
    const result = StepDefinitionSchema.safeParse({
      id: 'step-1',
      action: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid approval value', () => {
    const result = StepDefinitionSchema.safeParse({
      id: 'step-1',
      action: 'do-thing',
      approval: 'always',
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative timeout', () => {
    const result = StepDefinitionSchema.safeParse({
      id: 'step-1',
      action: 'do-thing',
      timeout: -100,
    });
    expect(result.success).toBe(false);
  });
});

describe('WorkflowDefinitionSchema', () => {
  it('accepts a valid workflow', () => {
    const result = WorkflowDefinitionSchema.safeParse({
      workflow: 'test',
      trigger: 'do something',
      steps: [{ id: 'a', action: 'act' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects workflow without steps', () => {
    const result = WorkflowDefinitionSchema.safeParse({
      workflow: 'test',
      trigger: 'do something',
      steps: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects workflow without name', () => {
    const result = WorkflowDefinitionSchema.safeParse({
      trigger: 'do something',
      steps: [{ id: 'a', action: 'act' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects workflow without trigger', () => {
    const result = WorkflowDefinitionSchema.safeParse({
      workflow: 'test',
      steps: [{ id: 'a', action: 'act' }],
    });
    expect(result.success).toBe(false);
  });
});

describe('validateDependencyReferences', () => {
  it('returns no errors for valid references', () => {
    const errors = validateDependencyReferences([
      { id: 'a', action: 'act' },
      { id: 'b', action: 'act', depends_on: ['a'] },
    ]);
    expect(errors).toEqual([]);
  });

  it('returns errors for missing references', () => {
    const errors = validateDependencyReferences([
      { id: 'a', action: 'act' },
      { id: 'b', action: 'act', depends_on: ['c'] },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('unknown step "c"');
  });

  it('returns no errors when there are no dependencies', () => {
    const errors = validateDependencyReferences([
      { id: 'a', action: 'act' },
      { id: 'b', action: 'act' },
    ]);
    expect(errors).toEqual([]);
  });
});

describe('validateUniqueStepIds', () => {
  it('returns no errors for unique IDs', () => {
    const errors = validateUniqueStepIds([
      { id: 'a', action: 'act' },
      { id: 'b', action: 'act' },
    ]);
    expect(errors).toEqual([]);
  });

  it('returns errors for duplicate IDs', () => {
    const errors = validateUniqueStepIds([
      { id: 'a', action: 'act' },
      { id: 'a', action: 'act2' },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Duplicate step id');
  });
});

describe('validateWorkflow', () => {
  it('accepts a valid complete workflow', () => {
    const result = validateWorkflow({
      workflow: 'travel',
      trigger: 'go somewhere',
      steps: [
        { id: 'a', action: 'book', realm: 'travel' },
        { id: 'b', action: 'pack', depends_on: ['a'] },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.data?.workflow).toBe('travel');
  });

  it('rejects invalid structure', () => {
    const result = validateWorkflow({ foo: 'bar' });
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects missing dependency references', () => {
    const result = validateWorkflow({
      workflow: 'test',
      trigger: 'go',
      steps: [
        { id: 'a', action: 'act' },
        { id: 'b', action: 'act', depends_on: ['nonexistent'] },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('unknown step');
  });

  it('rejects duplicate step IDs', () => {
    const result = validateWorkflow({
      workflow: 'test',
      trigger: 'go',
      steps: [
        { id: 'a', action: 'act' },
        { id: 'a', action: 'act2' },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('Duplicate');
  });
});
