/**
 * YAML workflow file parser.
 *
 * Reads workflow YAML files, validates them against the schema,
 * and returns typed WorkflowDefinition objects.
 */

import { readFile } from 'node:fs/promises';
import { parse as parseYAML } from 'yaml';
import { validateWorkflow } from './schema.js';
import { validateDAG } from './dag.js';
import type { WorkflowDefinition } from './types.js';

export class WorkflowParseError extends Error {
  constructor(
    message: string,
    public readonly errors: string[],
  ) {
    super(message);
    this.name = 'WorkflowParseError';
  }
}

/**
 * Parse a YAML string into a validated WorkflowDefinition.
 */
export function parseWorkflowString(yamlStr: string): WorkflowDefinition {
  let raw: unknown;
  try {
    raw = parseYAML(yamlStr);
  } catch (err) {
    throw new WorkflowParseError('Invalid YAML syntax', [
      err instanceof Error ? err.message : String(err),
    ]);
  }

  // Validate with Zod schema
  const schemaResult = validateWorkflow(raw);
  if (!schemaResult.success || !schemaResult.data) {
    throw new WorkflowParseError(
      'Workflow validation failed',
      schemaResult.errors,
    );
  }

  // Validate DAG structure (cycles, missing refs)
  const dagErrors = validateDAG(schemaResult.data.steps);
  if (dagErrors.length > 0) {
    throw new WorkflowParseError('Workflow DAG validation failed', dagErrors);
  }

  return schemaResult.data as WorkflowDefinition;
}

/**
 * Parse a workflow YAML file from disk.
 */
export async function parseWorkflowFile(
  filePath: string,
): Promise<WorkflowDefinition> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch (err) {
    throw new WorkflowParseError(`Failed to read file: ${filePath}`, [
      err instanceof Error ? err.message : String(err),
    ]);
  }

  return parseWorkflowString(content);
}

/**
 * Replace {{var}} placeholders in a params record with actual values.
 */
export function interpolateParams(
  params: Record<string, string> | undefined,
  args: Record<string, string>,
): Record<string, string> {
  if (!params) return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    result[key] = value.replace(/\{\{(\w+)\}\}/g, (_match, varName: string) => {
      if (varName in args) {
        return args[varName];
      }
      return `{{${varName}}}`;
    });
  }
  return result;
}
