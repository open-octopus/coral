/**
 * Zod schemas for validating workflow YAML files.
 */

import { z } from 'zod';

/** Schema for retry configuration. */
export const RetryConfigSchema = z.object({
  max: z.number().int().positive(),
  delay: z.number().int().nonnegative(),
});

/** Schema for a single step definition. */
export const StepDefinitionSchema = z.object({
  id: z.string().min(1, 'Step id must be a non-empty string'),
  realm: z.string().min(1).optional(),
  action: z.string().min(1, 'Step action must be a non-empty string'),
  params: z.record(z.string(), z.string()).optional(),
  depends_on: z.array(z.string().min(1)).optional(),
  approval: z.enum(['required', 'optional']).optional(),
  timeout: z.number().int().positive().optional(),
  retry: RetryConfigSchema.optional(),
});

/** Schema for the complete workflow definition. */
export const WorkflowDefinitionSchema = z.object({
  workflow: z.string().min(1, 'Workflow name must be a non-empty string'),
  trigger: z.string().min(1, 'Trigger must be a non-empty string'),
  steps: z
    .array(StepDefinitionSchema)
    .min(1, 'Workflow must have at least one step'),
});

/**
 * Validate that all depends_on references point to existing step IDs.
 * Returns an array of error messages (empty if valid).
 */
export function validateDependencyReferences(
  steps: z.infer<typeof StepDefinitionSchema>[],
): string[] {
  const errors: string[] = [];
  const stepIds = new Set(steps.map((s) => s.id));

  for (const step of steps) {
    if (step.depends_on) {
      for (const dep of step.depends_on) {
        if (!stepIds.has(dep)) {
          errors.push(
            `Step "${step.id}" depends on unknown step "${dep}"`,
          );
        }
      }
    }
  }

  return errors;
}

/**
 * Validate that step IDs are unique.
 * Returns an array of error messages (empty if valid).
 */
export function validateUniqueStepIds(
  steps: z.infer<typeof StepDefinitionSchema>[],
): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const step of steps) {
    if (seen.has(step.id)) {
      errors.push(`Duplicate step id: "${step.id}"`);
    }
    seen.add(step.id);
  }

  return errors;
}

/**
 * Full validation of a workflow definition including structural,
 * reference, and uniqueness checks. Returns errors or the parsed definition.
 */
export function validateWorkflow(data: unknown): {
  success: boolean;
  data?: z.infer<typeof WorkflowDefinitionSchema>;
  errors: string[];
} {
  const result = WorkflowDefinitionSchema.safeParse(data);

  if (!result.success) {
    return {
      success: false,
      errors: result.error.issues.map(
        (i) => `${i.path.join('.')}: ${i.message}`,
      ),
    };
  }

  const allErrors = [
    ...validateUniqueStepIds(result.data.steps),
    ...validateDependencyReferences(result.data.steps),
  ];

  if (allErrors.length > 0) {
    return { success: false, errors: allErrors };
  }

  return { success: true, data: result.data, errors: [] };
}
