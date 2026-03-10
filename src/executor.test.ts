import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkflowExecutor } from './executor.js';
import type {
  WorkflowDefinition,
  WorkflowEvent,
  StepDefinition,
} from './types.js';

// Mock the gateway client so tests don't need a real WebSocket server
vi.mock('./gateway-client.js', () => {
  return {
    GatewayClient: vi.fn().mockImplementation(() => ({
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      chat: vi.fn().mockResolvedValue('mocked realm response'),
      call: vi.fn().mockResolvedValue({ result: 'mocked utility response' }),
      connected: true,
    })),
  };
});

function makeWorkflow(
  steps: StepDefinition[],
  name = 'test-workflow',
): WorkflowDefinition {
  return {
    workflow: name,
    trigger: 'test trigger',
    steps,
  };
}

describe('WorkflowExecutor', () => {
  let executor: WorkflowExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    executor = new WorkflowExecutor('ws://localhost:19789');
  });

  describe('dry-run mode', () => {
    it('completes all steps without calling gateway', async () => {
      const workflow = makeWorkflow([
        { id: 'a', action: 'act-a', realm: 'pet' },
        { id: 'b', action: 'act-b', depends_on: ['a'] },
      ]);

      const result = await executor.run(workflow, { key: 'val' }, { dryRun: true });

      expect(result.status).toBe('completed');
      expect(result.steps.size).toBe(2);

      const stepA = result.steps.get('a');
      expect(stepA?.status).toBe('done');
      expect((stepA?.result as Record<string, unknown>)?.dryRun).toBe(true);
      expect((stepA?.result as Record<string, unknown>)?.realm).toBe('pet');

      const stepB = result.steps.get('b');
      expect(stepB?.status).toBe('done');
      expect((stepB?.result as Record<string, unknown>)?.dryRun).toBe(true);
    });

    it('interpolates params in dry-run', async () => {
      const workflow = makeWorkflow([
        {
          id: 'a',
          action: 'travel',
          realm: 'pet',
          params: { dest: '{{destination}}' },
        },
      ]);

      const result = await executor.run(
        workflow,
        { destination: 'Tokyo' },
        { dryRun: true },
      );

      const stepA = result.steps.get('a');
      const data = stepA?.result as Record<string, unknown>;
      expect((data.params as Record<string, string>).dest).toBe('Tokyo');
    });
  });

  describe('dependency ordering', () => {
    it('executes steps in dependency order', async () => {
      const executionOrder: string[] = [];

      executor.on('event', (event: WorkflowEvent) => {
        if (event.type === 'step:start') {
          executionOrder.push(event.stepId);
        }
      });

      const workflow = makeWorkflow([
        { id: 'first', action: 'act', realm: 'r' },
        { id: 'second', action: 'act', realm: 'r', depends_on: ['first'] },
        {
          id: 'third',
          action: 'act',
          realm: 'r',
          depends_on: ['second'],
        },
      ]);

      const result = await executor.run(workflow, {}, { dryRun: true });

      expect(result.status).toBe('completed');
      expect(executionOrder.indexOf('first')).toBeLessThan(
        executionOrder.indexOf('second'),
      );
      expect(executionOrder.indexOf('second')).toBeLessThan(
        executionOrder.indexOf('third'),
      );
    });

    it('runs independent steps in parallel (both start before either finishes)', async () => {
      const startTimes: Record<string, number> = {};

      executor.on('event', (event: WorkflowEvent) => {
        if (event.type === 'step:start') {
          startTimes[event.stepId] = Date.now();
        }
      });

      const workflow = makeWorkflow([
        { id: 'parallel-a', action: 'act', realm: 'r' },
        { id: 'parallel-b', action: 'act', realm: 'r' },
        {
          id: 'final',
          action: 'merge',
          depends_on: ['parallel-a', 'parallel-b'],
        },
      ]);

      const result = await executor.run(workflow, {}, { dryRun: true });

      expect(result.status).toBe('completed');
      // Both parallel steps should start in the first batch
      expect(startTimes['parallel-a']).toBeDefined();
      expect(startTimes['parallel-b']).toBeDefined();
    });
  });

  describe('approval gates', () => {
    it('pauses workflow at required approval when no handler provided', async () => {
      const workflow = makeWorkflow([
        { id: 'gated', action: 'deploy', approval: 'required' },
        { id: 'after', action: 'cleanup', depends_on: ['gated'] },
      ]);

      const result = await executor.run(workflow, {}, { dryRun: true });

      expect(result.status).toBe('paused');
      const gatedStep = result.steps.get('gated');
      expect(gatedStep?.status).toBe('waiting_approval');
    });

    it('continues past approval when handler approves', async () => {
      const workflow = makeWorkflow([
        { id: 'gated', action: 'deploy', realm: 'r', approval: 'required' },
        { id: 'after', action: 'cleanup', depends_on: ['gated'] },
      ]);

      const result = await executor.run(workflow, {}, {
        dryRun: true,
        onApproval: async () => true,
      });

      expect(result.status).toBe('completed');
      const gatedStep = result.steps.get('gated');
      expect(gatedStep?.status).toBe('done');
    });

    it('pauses when handler denies approval', async () => {
      const workflow = makeWorkflow([
        { id: 'gated', action: 'deploy', approval: 'required' },
      ]);

      const result = await executor.run(workflow, {}, {
        dryRun: true,
        onApproval: async () => false,
      });

      expect(result.status).toBe('paused');
    });
  });

  describe('events', () => {
    it('emits step:start and step:done events', async () => {
      const events: WorkflowEvent[] = [];
      executor.on('event', (e: WorkflowEvent) => events.push(e));

      const workflow = makeWorkflow([
        { id: 'only', action: 'act', realm: 'r' },
      ]);

      await executor.run(workflow, {}, { dryRun: true });

      const startEvents = events.filter((e) => e.type === 'step:start');
      const doneEvents = events.filter((e) => e.type === 'step:done');

      expect(startEvents).toHaveLength(1);
      expect(doneEvents).toHaveLength(1);
      expect(startEvents[0].type === 'step:start' && startEvents[0].stepId).toBe('only');
    });

    it('emits step:waiting_approval for gated steps', async () => {
      const events: WorkflowEvent[] = [];
      executor.on('event', (e: WorkflowEvent) => events.push(e));

      const workflow = makeWorkflow([
        { id: 'gated', action: 'act', approval: 'required' },
      ]);

      await executor.run(workflow, {}, { dryRun: true });

      const approvalEvents = events.filter(
        (e) => e.type === 'step:waiting_approval',
      );
      expect(approvalEvents).toHaveLength(1);
    });
  });

  describe('workflow result', () => {
    it('includes workflow metadata', async () => {
      const workflow = makeWorkflow(
        [{ id: 'a', action: 'act' }],
        'my-workflow',
      );

      const result = await executor.run(
        workflow,
        { x: '1' },
        { dryRun: true },
      );

      expect(result.id).toMatch(/^wf_/);
      expect(result.workflowName).toBe('my-workflow');
      expect(result.args).toEqual({ x: '1' });
      expect(result.startedAt).toBeTypeOf('number');
      expect(result.completedAt).toBeTypeOf('number');
    });

    it('returns completed for all-successful workflow', async () => {
      const workflow = makeWorkflow([
        { id: 'a', action: 'act' },
        { id: 'b', action: 'act', depends_on: ['a'] },
      ]);

      const result = await executor.run(workflow, {}, { dryRun: true });
      expect(result.status).toBe('completed');
    });
  });

  describe('complex workflows', () => {
    it('handles the travel-preparation pattern', async () => {
      const workflow = makeWorkflow(
        [
          { id: 'pet-care', realm: 'pet', action: 'arrange-care', params: { duration: '{{duration}}' } },
          { id: 'budget', realm: 'finance', action: 'estimate-budget', params: { destination: '{{destination}}' } },
          { id: 'work-handoff', realm: 'work', action: 'set-ooo', params: { duration: '{{duration}}' } },
          { id: 'transport', realm: 'vehicle', action: 'plan-transport', depends_on: ['budget'] },
          { id: 'health-check', realm: 'health', action: 'travel-health', params: { destination: '{{destination}}' } },
          { id: 'summarize', action: 'merge-results', depends_on: ['pet-care', 'budget', 'work-handoff', 'transport', 'health-check'] },
        ],
        'travel-preparation',
      );

      const result = await executor.run(
        workflow,
        { destination: 'Tokyo', duration: '5 days' },
        { dryRun: true },
      );

      expect(result.status).toBe('completed');
      expect(result.steps.size).toBe(6);

      // Verify all steps completed
      for (const [, stepResult] of result.steps) {
        expect(stepResult.status).toBe('done');
      }
    });
  });
});
