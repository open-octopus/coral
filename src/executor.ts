/**
 * Workflow executor with DAG-based dependency resolution.
 *
 * Runs steps in parallel where possible, respects depends_on ordering,
 * supports approval gates, dry-run mode, and timeout/retry.
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { buildDAG, getReadySteps, topologicalSort } from './dag.js';
import { WorkflowContext } from './context.js';
import { GatewayClient } from './gateway-client.js';
import type {
  StepDefinition,
  StepResult,
  WorkflowDefinition,
  WorkflowEvent,
  WorkflowRun,
  WorkflowRunOptions,
} from './types.js';

export class WorkflowExecutor extends EventEmitter {
  private client: GatewayClient;

  constructor(gatewayUrl: string) {
    super();
    this.client = new GatewayClient(gatewayUrl);
  }

  /**
   * Execute a workflow with the given arguments.
   */
  async run(
    workflow: WorkflowDefinition,
    args: Record<string, string>,
    options?: WorkflowRunOptions,
  ): Promise<WorkflowRun> {
    const dryRun = options?.dryRun ?? false;
    const dag = buildDAG(workflow.steps);
    const stepMap = new Map(workflow.steps.map((s) => [s.id, s]));
    const context = new WorkflowContext(workflow.steps);

    // Validate execution order
    topologicalSort(dag);

    const run = createRun(
      workflow.workflow,
      args,
      workflow.steps.map((s) => s.id),
    );

    if (!dryRun) {
      try {
        await this.client.connect();
      } catch {
        // If gateway is unreachable, we still track the run as failed
        run.status = 'failed';
        run.completedAt = Date.now();
        return run;
      }
    }

    try {
      const completed = new Set<string>();
      const failed = new Set<string>();
      const running = new Set<string>();

      while (completed.size + failed.size < dag.size) {
        const ready = getReadySteps(dag, completed, running);

        if (ready.length === 0 && running.size === 0) {
          // No more steps can run — some steps are blocked by failures
          break;
        }

        if (ready.length === 0) {
          // Steps are running but none are ready — wait a tick
          await new Promise((resolve) => setTimeout(resolve, 10));
          continue;
        }

        // Launch all ready steps in parallel
        const promises = ready.map(async (stepId) => {
          const step = stepMap.get(stepId)!;
          running.add(stepId);

          const result = await this.executeStep(
            step,
            args,
            context,
            dryRun,
            options?.onApproval,
          );

          running.delete(stepId);
          run.steps.set(stepId, result);
          context.setStepResult(stepId, result);

          if (
            result.status === 'done' ||
            result.status === 'skipped'
          ) {
            completed.add(stepId);
          } else if (result.status === 'waiting_approval') {
            // Treat as paused — mark completed so dependents don't run
            // until approval is resolved
            run.status = 'paused';
            completed.add(stepId);
          } else {
            failed.add(stepId);
          }
        });

        await Promise.all(promises);

        if (run.status === 'paused') {
          break;
        }
      }

      if (run.status !== 'paused') {
        run.status =
          failed.size > 0 ? 'failed' : 'completed';
      }
    } finally {
      run.completedAt = Date.now();
      if (!dryRun) {
        this.client.disconnect();
      }
    }

    return run;
  }

  private async executeStep(
    step: StepDefinition,
    args: Record<string, string>,
    context: WorkflowContext,
    dryRun: boolean,
    onApproval?: (stepId: string, step: StepDefinition) => Promise<boolean>,
  ): Promise<StepResult> {
    const result: StepResult = {
      stepId: step.id,
      status: 'running',
      startedAt: Date.now(),
    };

    this.emit('event', {
      type: 'step:start',
      stepId: step.id,
      step,
    } satisfies WorkflowEvent);

    // Check approval gate
    if (step.approval === 'required') {
      if (onApproval) {
        const approved = await onApproval(step.id, step);
        if (!approved) {
          result.status = 'waiting_approval';
          this.emit('event', {
            type: 'step:waiting_approval',
            stepId: step.id,
            step,
          } satisfies WorkflowEvent);
          return result;
        }
      } else {
        result.status = 'waiting_approval';
        this.emit('event', {
          type: 'step:waiting_approval',
          stepId: step.id,
          step,
        } satisfies WorkflowEvent);
        return result;
      }
    }

    // Dry run — just report what would happen
    if (dryRun) {
      const interpolatedParams = context.interpolateParams(step.params, args);
      result.status = 'done';
      result.result = {
        dryRun: true,
        action: step.action,
        realm: step.realm ?? '(utility)',
        params: interpolatedParams,
      };
      result.completedAt = Date.now();

      this.emit('event', {
        type: 'step:done',
        stepId: step.id,
        result,
      } satisfies WorkflowEvent);

      return result;
    }

    // Execute the step via gateway
    const maxRetries = step.retry?.max ?? 0;
    const retryDelay = step.retry?.delay ?? 1000;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const interpolatedParams = context.interpolateParams(
          step.params,
          args,
        );

        let response: unknown;

        if (step.realm) {
          // Realm-scoped step: send via chat.send to the realm
          const message = `[coral workflow] Action: ${step.action}. Params: ${JSON.stringify(interpolatedParams)}`;

          const timeoutMs = step.timeout;
          if (timeoutMs) {
            response = await Promise.race([
              this.client.chat(message, { realm: step.realm }),
              new Promise((_, reject) =>
                setTimeout(
                  () => reject(new Error(`Step "${step.id}" timed out after ${timeoutMs}ms`)),
                  timeoutMs,
                ),
              ),
            ]);
          } else {
            response = await this.client.chat(message, {
              realm: step.realm,
            });
          }
        } else {
          // Utility step (no realm): call a generic action
          response = await this.client.call(`action.${step.action}`, {
            params: context.interpolateParams(step.params, args),
          });
        }

        result.status = 'done';
        result.result = response;
        result.completedAt = Date.now();

        this.emit('event', {
          type: 'step:done',
          stepId: step.id,
          result,
        } satisfies WorkflowEvent);

        return result;
      } catch (err) {
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          continue;
        }

        result.status = 'failed';
        result.error = err instanceof Error ? err.message : String(err);
        result.completedAt = Date.now();

        this.emit('event', {
          type: 'step:failed',
          stepId: step.id,
          result,
        } satisfies WorkflowEvent);

        return result;
      }
    }

    // Should not reach here, but TypeScript requires a return
    return result;
  }
}

function createRun(
  workflowName: string,
  args: Record<string, string>,
  stepIds: string[],
): WorkflowRun {
  const steps = new Map<string, StepResult>();
  for (const stepId of stepIds) {
    steps.set(stepId, { stepId, status: 'pending' });
  }
  return {
    id: `wf_${randomUUID()}`,
    workflowName,
    args,
    steps,
    status: 'running',
    startedAt: Date.now(),
  };
}
