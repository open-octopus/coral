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

/** Merge two sets into a new set (union). */
function union<T>(...sets: Set<T>[]): Set<T> {
  const result = new Set<T>();
  for (const s of sets) {
    for (const v of s) result.add(v);
  }
  return result;
}

export class WorkflowExecutor extends EventEmitter {
  private client: GatewayClient;

  constructor(gatewayUrl: string) {
    super();
    this.client = new GatewayClient(gatewayUrl);
  }

  /**
   * Resume a paused or failed workflow run from saved state.
   * Skips steps that already completed; re-runs pending/failed steps.
   */
  async resume(
    workflow: WorkflowDefinition,
    savedRun: WorkflowRun,
    options?: WorkflowRunOptions,
    overrides?: { approve?: string[]; reject?: string[] },
  ): Promise<WorkflowRun> {
    const dryRun = options?.dryRun ?? false;
    const dag = buildDAG(workflow.steps);
    const stepMap = new Map(workflow.steps.map((s) => [s.id, s]));
    const context = new WorkflowContext(workflow.steps);

    topologicalSort(dag);

    const run = savedRun;
    (run as { status: string }).status = 'running';
    run.completedAt = undefined;

    // Handle override approvals/rejections
    const approveSet = new Set(overrides?.approve ?? []);
    const rejectSet = new Set(overrides?.reject ?? []);

    // Rebuild completed/failed sets from saved state
    const completed = new Set<string>();
    const failed = new Set<string>();

    for (const [stepId, stepResult] of run.steps) {
      if (stepResult.status === 'done' || stepResult.status === 'skipped') {
        completed.add(stepId);
        context.setStepResult(stepId, stepResult);
      } else if (stepResult.status === 'waiting_approval') {
        if (approveSet.has(stepId)) {
          stepResult.status = 'pending';
        } else if (rejectSet.has(stepId)) {
          stepResult.status = 'skipped';
          completed.add(stepId);
        }
      } else if (stepResult.status === 'failed') {
        stepResult.status = 'pending';
      }
    }

    if (!dryRun) {
      try {
        await this.client.connect();
      } catch {
        run.status = 'failed';
        run.completedAt = Date.now();
        return run;
      }
    }

    try {
      const running = new Set<string>();

      while (completed.size + failed.size < dag.size) {
        // Pass union of completed+failed so failed steps aren't re-picked
        const ready = getReadySteps(dag, union(completed, failed), running);

        if (ready.length === 0 && running.size === 0) break;

        if (ready.length === 0) {
          await new Promise((resolve) => setTimeout(resolve, 10));
          continue;
        }

        const promises = ready.map(async (stepId) => {
          const step = stepMap.get(stepId)!;
          running.add(stepId);

          let onApproval = options?.onApproval;
          if (approveSet.has(stepId)) {
            onApproval = async () => true;
          }

          const result = await this.executeStep(
            step,
            run.args,
            context,
            dryRun,
            onApproval,
          );

          running.delete(stepId);
          run.steps.set(stepId, result);
          context.setStepResult(stepId, result);

          if (result.status === 'done' || result.status === 'skipped') {
            completed.add(stepId);
          } else if (result.status === 'waiting_approval') {
            run.status = 'paused';
            completed.add(stepId);
          } else {
            failed.add(stepId);
          }
        });

        await Promise.all(promises);

        if (run.status === 'paused') break;
      }

      if (run.status !== 'paused') {
        run.status = failed.size > 0 ? 'failed' : 'completed';
      }
    } finally {
      run.completedAt = Date.now();
      if (!dryRun) {
        this.client.disconnect();
      }
    }

    return run;
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
        // Pass union of completed+failed so failed steps aren't re-picked
        const ready = getReadySteps(dag, union(completed, failed), running);

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

        const strategy = step.on_failure ?? 'fail';

        if (strategy === 'skip') {
          result.status = 'skipped';
          result.error = err instanceof Error ? err.message : String(err);
          result.completedAt = Date.now();

          this.emit('event', {
            type: 'step:skipped',
            stepId: step.id,
            reason: `Skipped due to failure: ${result.error}`,
          } satisfies WorkflowEvent);

          return result;
        }

        if (strategy === 'fallback' && step.fallback_action) {
          try {
            const fallbackResponse = step.realm
              ? await this.client.chat(
                  `[coral workflow fallback] Action: ${step.fallback_action}. Params: ${JSON.stringify(context.interpolateParams(step.params, args))}`,
                  { realm: step.realm },
                )
              : await this.client.call(`action.${step.fallback_action}`, {
                  params: context.interpolateParams(step.params, args),
                });

            result.status = 'done';
            result.result = fallbackResponse;
            result.completedAt = Date.now();

            this.emit('event', {
              type: 'step:done',
              stepId: step.id,
              result,
            } satisfies WorkflowEvent);

            return result;
          } catch (fallbackErr) {
            result.status = 'failed';
            result.error = `Fallback also failed: ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`;
            result.completedAt = Date.now();

            this.emit('event', {
              type: 'step:failed',
              stepId: step.id,
              result,
            } satisfies WorkflowEvent);

            return result;
          }
        }

        // Default: fail
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
