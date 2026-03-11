import { describe, it, expect } from 'vitest';
import {
  isApprovalMode,
  isFailureStrategy,
  isStepStatus,
  isWorkflowStatus,
  createStepResult,
  createWorkflowRun,
} from './types.js';

describe('type guards', () => {
  describe('isApprovalMode', () => {
    it('returns true for "required"', () => {
      expect(isApprovalMode('required')).toBe(true);
    });

    it('returns true for "optional"', () => {
      expect(isApprovalMode('optional')).toBe(true);
    });

    it('returns false for invalid values', () => {
      expect(isApprovalMode('always')).toBe(false);
      expect(isApprovalMode(null)).toBe(false);
      expect(isApprovalMode(42)).toBe(false);
      expect(isApprovalMode(undefined)).toBe(false);
    });
  });

  describe('isStepStatus', () => {
    it('returns true for all valid statuses', () => {
      expect(isStepStatus('pending')).toBe(true);
      expect(isStepStatus('running')).toBe(true);
      expect(isStepStatus('done')).toBe(true);
      expect(isStepStatus('failed')).toBe(true);
      expect(isStepStatus('skipped')).toBe(true);
      expect(isStepStatus('waiting_approval')).toBe(true);
    });

    it('returns false for invalid values', () => {
      expect(isStepStatus('cancelled')).toBe(false);
      expect(isStepStatus('')).toBe(false);
      expect(isStepStatus(0)).toBe(false);
    });
  });

  describe('isFailureStrategy', () => {
    it('returns true for "fail"', () => {
      expect(isFailureStrategy('fail')).toBe(true);
    });

    it('returns true for "skip"', () => {
      expect(isFailureStrategy('skip')).toBe(true);
    });

    it('returns true for "fallback"', () => {
      expect(isFailureStrategy('fallback')).toBe(true);
    });

    it('returns false for invalid values', () => {
      expect(isFailureStrategy('retry')).toBe(false);
      expect(isFailureStrategy(null)).toBe(false);
      expect(isFailureStrategy(undefined)).toBe(false);
      expect(isFailureStrategy(42)).toBe(false);
    });
  });

  describe('isWorkflowStatus', () => {
    it('returns true for all valid statuses', () => {
      expect(isWorkflowStatus('running')).toBe(true);
      expect(isWorkflowStatus('paused')).toBe(true);
      expect(isWorkflowStatus('completed')).toBe(true);
      expect(isWorkflowStatus('failed')).toBe(true);
    });

    it('returns false for invalid values', () => {
      expect(isWorkflowStatus('cancelled')).toBe(false);
      expect(isWorkflowStatus(null)).toBe(false);
    });
  });
});

describe('constructors', () => {
  describe('createStepResult', () => {
    it('creates a pending step result', () => {
      const result = createStepResult('my-step');
      expect(result).toEqual({
        stepId: 'my-step',
        status: 'pending',
      });
    });

    it('does not include optional fields', () => {
      const result = createStepResult('s1');
      expect(result.result).toBeUndefined();
      expect(result.error).toBeUndefined();
      expect(result.startedAt).toBeUndefined();
      expect(result.completedAt).toBeUndefined();
    });
  });

  describe('createWorkflowRun', () => {
    it('creates a running workflow with pending steps', () => {
      const run = createWorkflowRun('wf_123', 'test-workflow', { a: '1' }, [
        'step-a',
        'step-b',
      ]);

      expect(run.id).toBe('wf_123');
      expect(run.workflowName).toBe('test-workflow');
      expect(run.args).toEqual({ a: '1' });
      expect(run.status).toBe('running');
      expect(run.startedAt).toBeTypeOf('number');
      expect(run.completedAt).toBeUndefined();

      expect(run.steps.size).toBe(2);
      expect(run.steps.get('step-a')?.status).toBe('pending');
      expect(run.steps.get('step-b')?.status).toBe('pending');
    });

    it('creates an empty steps map for no step IDs', () => {
      const run = createWorkflowRun('wf_0', 'empty', {}, []);
      expect(run.steps.size).toBe(0);
    });
  });
});
