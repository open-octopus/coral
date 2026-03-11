import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RunStore } from './run-store.js';
import type { WorkflowRun, StepResult } from './types.js';

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'coral-runstore-test-'));
}

function makeRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  const steps = new Map<string, StepResult>();
  steps.set('step-a', {
    stepId: 'step-a',
    status: 'done',
    result: { value: 42 },
    startedAt: 1000,
    completedAt: 2000,
  });
  steps.set('step-b', {
    stepId: 'step-b',
    status: 'failed',
    error: 'something went wrong',
    startedAt: 2000,
    completedAt: 3000,
  });

  return {
    id: 'run-001',
    workflowName: 'test-workflow',
    args: { destination: 'Tokyo', duration: '5 days' },
    steps,
    status: 'completed',
    startedAt: 1000,
    completedAt: 5000,
    ...overrides,
  };
}

describe('RunStore', () => {
  let tmpDir: string;
  let store: RunStore;

  function setup(): void {
    tmpDir = makeTmpDir();
    store = new RunStore(tmpDir);
  }

  afterEach(() => {
    if (tmpDir && existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('save / load round-trip', () => {
    it('preserves all scalar fields', () => {
      setup();
      const run = makeRun();
      store.save(run);

      const loaded = store.load('run-001');
      expect(loaded).not.toBeNull();
      expect(loaded!.run.id).toBe(run.id);
      expect(loaded!.run.workflowName).toBe(run.workflowName);
      expect(loaded!.run.args).toEqual(run.args);
      expect(loaded!.run.status).toBe(run.status);
      expect(loaded!.run.startedAt).toBe(run.startedAt);
      expect(loaded!.run.completedAt).toBe(run.completedAt);
    });

    it('correctly serializes/deserializes Map (steps)', () => {
      setup();
      const run = makeRun();
      store.save(run);

      const loaded = store.load('run-001');
      expect(loaded).not.toBeNull();

      const steps = loaded!.run.steps;
      expect(steps).toBeInstanceOf(Map);
      expect(steps.size).toBe(2);

      const stepA = steps.get('step-a');
      expect(stepA).toBeDefined();
      expect(stepA!.stepId).toBe('step-a');
      expect(stepA!.status).toBe('done');
      expect(stepA!.result).toEqual({ value: 42 });
      expect(stepA!.startedAt).toBe(1000);
      expect(stepA!.completedAt).toBe(2000);

      const stepB = steps.get('step-b');
      expect(stepB).toBeDefined();
      expect(stepB!.stepId).toBe('step-b');
      expect(stepB!.status).toBe('failed');
      expect(stepB!.error).toBe('something went wrong');
    });

    it('preserves optional workflowFile', () => {
      setup();
      const run = makeRun();
      store.save(run, '/path/to/workflow.yaml');

      const loaded = store.load('run-001');
      expect(loaded).not.toBeNull();
      expect(loaded!.workflowFile).toBe('/path/to/workflow.yaml');
    });

    it('returns undefined workflowFile when not provided', () => {
      setup();
      const run = makeRun();
      store.save(run);

      const loaded = store.load('run-001');
      expect(loaded).not.toBeNull();
      expect(loaded!.workflowFile).toBeUndefined();
    });
  });

  describe('load', () => {
    it('returns null for non-existent runId', () => {
      setup();
      const result = store.load('does-not-exist');
      expect(result).toBeNull();
    });
  });

  describe('list', () => {
    it('returns empty array when no data exists', () => {
      setup();
      const items = store.list();
      expect(items).toEqual([]);
    });

    it('returns summary info (id, workflowName, status, startedAt)', () => {
      setup();
      const run1 = makeRun({ id: 'run-aaa', workflowName: 'wf-alpha', status: 'completed', startedAt: 100 });
      const run2 = makeRun({ id: 'run-bbb', workflowName: 'wf-beta', status: 'failed', startedAt: 200 });

      store.save(run1);
      store.save(run2);

      const items = store.list();
      expect(items).toHaveLength(2);

      // Sort for deterministic assertion
      items.sort((a, b) => a.id.localeCompare(b.id));

      expect(items[0]).toEqual({
        id: 'run-aaa',
        workflowName: 'wf-alpha',
        status: 'completed',
        startedAt: 100,
      });
      expect(items[1]).toEqual({
        id: 'run-bbb',
        workflowName: 'wf-beta',
        status: 'failed',
        startedAt: 200,
      });
    });
  });

  describe('delete', () => {
    it('returns true and subsequent load returns null', () => {
      setup();
      const run = makeRun();
      store.save(run);

      expect(store.load('run-001')).not.toBeNull();
      const deleted = store.delete('run-001');
      expect(deleted).toBe(true);
      expect(store.load('run-001')).toBeNull();
    });

    it('returns false for non-existent runId', () => {
      setup();
      const result = store.delete('no-such-run');
      expect(result).toBe(false);
    });
  });

  describe('constructor', () => {
    it('auto-creates directory if it does not exist', () => {
      const nestedDir = join(makeTmpDir(), 'deep', 'nested', 'runs');
      expect(existsSync(nestedDir)).toBe(false);

      const nestedStore = new RunStore(nestedDir);
      expect(existsSync(nestedDir)).toBe(true);

      // Verify it is functional
      nestedStore.save(makeRun());
      expect(nestedStore.load('run-001')).not.toBeNull();

      // Cleanup the top-level temp dir
      const topDir = nestedDir.split('/deep/')[0];
      rmSync(topDir, { recursive: true, force: true });
    });
  });
});
