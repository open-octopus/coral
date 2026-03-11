/**
 * Core types for the coral cross-realm workflow engine.
 */

/** Approval modes for steps that require human confirmation. */
export type ApprovalMode = 'required' | 'optional';

/** Status of an individual workflow step. */
export type StepStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'failed'
  | 'skipped'
  | 'waiting_approval';

/** Status of an entire workflow run. */
export type WorkflowStatus = 'running' | 'paused' | 'completed' | 'failed';

/** Retry configuration for a step. */
export interface RetryConfig {
  max: number;
  delay: number;
}

/** Failure handling strategy for a step. */
export type FailureStrategy = 'fail' | 'skip' | 'fallback';

/** Definition of a single step within a workflow. */
export interface StepDefinition {
  id: string;
  realm?: string;
  action: string;
  params?: Record<string, string>;
  depends_on?: string[];
  approval?: ApprovalMode;
  timeout?: number;
  retry?: RetryConfig;
  on_failure?: FailureStrategy;
  fallback_action?: string;
}

/** Complete workflow definition, typically parsed from YAML. */
export interface WorkflowDefinition {
  workflow: string;
  trigger: string;
  steps: StepDefinition[];
}

/** Result of executing a single step. */
export interface StepResult {
  stepId: string;
  status: StepStatus;
  result?: unknown;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

/** A complete workflow execution run. */
export interface WorkflowRun {
  id: string;
  workflowName: string;
  args: Record<string, string>;
  steps: Map<string, StepResult>;
  status: WorkflowStatus;
  startedAt: number;
  completedAt?: number;
}

/** Options for running a workflow. */
export interface WorkflowRunOptions {
  dryRun?: boolean;
  onApproval?: (stepId: string, step: StepDefinition) => Promise<boolean>;
}

/** Events emitted during workflow execution. */
export type WorkflowEvent =
  | { type: 'step:start'; stepId: string; step: StepDefinition }
  | { type: 'step:done'; stepId: string; result: StepResult }
  | { type: 'step:failed'; stepId: string; result: StepResult }
  | { type: 'step:skipped'; stepId: string; reason: string }
  | { type: 'step:waiting_approval'; stepId: string; step: StepDefinition };

/** DAG adjacency list representation: stepId -> list of stepIds it depends on. */
export type DAG = Map<string, string[]>;

// ── Type Guards ───────────────────────────────────────────────────────

export function isFailureStrategy(value: unknown): value is FailureStrategy {
  return value === 'fail' || value === 'skip' || value === 'fallback';
}

export function isApprovalMode(value: unknown): value is ApprovalMode {
  return value === 'required' || value === 'optional';
}

export function isStepStatus(value: unknown): value is StepStatus {
  return (
    value === 'pending' ||
    value === 'running' ||
    value === 'done' ||
    value === 'failed' ||
    value === 'skipped' ||
    value === 'waiting_approval'
  );
}

export function isWorkflowStatus(value: unknown): value is WorkflowStatus {
  return (
    value === 'running' ||
    value === 'paused' ||
    value === 'completed' ||
    value === 'failed'
  );
}

// ── Constructors / Factories ──────────────────────────────────────────

export function createStepResult(stepId: string): StepResult {
  return {
    stepId,
    status: 'pending',
  };
}

export function createWorkflowRun(
  id: string,
  workflowName: string,
  args: Record<string, string>,
  stepIds: string[],
): WorkflowRun {
  const steps = new Map<string, StepResult>();
  for (const stepId of stepIds) {
    steps.set(stepId, createStepResult(stepId));
  }
  return {
    id,
    workflowName,
    args,
    steps,
    status: 'running',
    startedAt: Date.now(),
  };
}
