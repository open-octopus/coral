/**
 * coral — Cross-realm workflow engine for OpenOctopus.
 *
 * Public API exports.
 */

// Types
export type {
  ApprovalMode,
  StepStatus,
  WorkflowStatus,
  RetryConfig,
  StepDefinition,
  WorkflowDefinition,
  StepResult,
  WorkflowRun,
  WorkflowRunOptions,
  WorkflowEvent,
  DAG,
} from './types.js';

export {
  isApprovalMode,
  isStepStatus,
  isWorkflowStatus,
  createStepResult,
  createWorkflowRun,
} from './types.js';

// Schema validation
export {
  RetryConfigSchema,
  StepDefinitionSchema,
  WorkflowDefinitionSchema,
  validateDependencyReferences,
  validateUniqueStepIds,
  validateWorkflow,
} from './schema.js';

// DAG utilities
export {
  buildDAG,
  topologicalSort,
  detectCycles,
  getReadySteps,
  validateDAG,
} from './dag.js';

// Parser
export {
  parseWorkflowFile,
  parseWorkflowString,
  interpolateParams,
  WorkflowParseError,
} from './parser.js';

// Context
export { WorkflowContext } from './context.js';

// Executor
export { WorkflowExecutor } from './executor.js';

// Gateway client
export { GatewayClient } from './gateway-client.js';
