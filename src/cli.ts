#!/usr/bin/env node

/**
 * coral CLI — cross-realm workflow engine.
 *
 * Commands:
 *   coral run <workflow> --args '{...}' [--dry-run] [--file path]
 *   coral list
 *   coral validate <file>
 */

import { defineCommand, runMain } from 'citty';
import consola from 'consola';
import { readdir } from 'node:fs/promises';
import { resolve, extname, basename } from 'node:path';
import { parseWorkflowFile, parseWorkflowString, WorkflowParseError } from './parser.js';
import { WorkflowExecutor } from './executor.js';
import type { WorkflowEvent } from './types.js';

const DEFAULT_GATEWAY_URL = 'ws://localhost:19789';
const WORKFLOWS_DIR = resolve(process.cwd(), 'workflows');

// ── run command ───────────────────────────────────────────────────────

const runCommand = defineCommand({
  meta: {
    name: 'run',
    description: 'Run a workflow by name or file path',
  },
  args: {
    workflow: {
      type: 'positional',
      description: 'Workflow name or file path',
      required: false,
    },
    file: {
      type: 'string',
      description: 'Path to a workflow YAML file',
    },
    args: {
      type: 'string',
      description: 'JSON string of workflow arguments',
      default: '{}',
    },
    'dry-run': {
      type: 'boolean',
      description: 'Show what would execute without side effects',
      default: false,
    },
    gateway: {
      type: 'string',
      description: 'Gateway WebSocket URL',
      default: DEFAULT_GATEWAY_URL,
    },
  },
  async run({ args }) {
    const filePath = args.file ?? (args.workflow ? resolve(WORKFLOWS_DIR, `${args.workflow}.yml`) : null);

    if (!filePath) {
      consola.error('Provide a workflow name or --file path');
      process.exit(1);
    }

    let workflowArgs: Record<string, string>;
    try {
      workflowArgs = JSON.parse(args.args as string) as Record<string, string>;
    } catch {
      consola.error('Invalid --args JSON');
      process.exit(1);
    }

    const dryRun = args['dry-run'] as boolean;

    try {
      const workflow = await parseWorkflowFile(filePath);
      consola.info(`Starting workflow: ${workflow.workflow}${dryRun ? ' (dry-run)' : ''}`);

      const executor = new WorkflowExecutor(args.gateway as string);

      executor.on('event', (event: WorkflowEvent) => {
        switch (event.type) {
          case 'step:start':
            consola.info(
              `Step ${event.stepId.padEnd(20)} ... running${event.step.realm ? ` (${event.step.realm} Realm)` : ''}`,
            );
            break;
          case 'step:done':
            consola.success(
              `Step ${event.stepId.padEnd(20)} ... done`,
            );
            break;
          case 'step:failed':
            consola.error(
              `Step ${event.stepId.padEnd(20)} ... failed — ${event.result.error}`,
            );
            break;
          case 'step:skipped':
            consola.warn(
              `Step ${event.stepId.padEnd(20)} ... skipped — ${event.reason}`,
            );
            break;
          case 'step:waiting_approval':
            consola.warn(
              `Step ${event.stepId.padEnd(20)} ... waiting for approval`,
            );
            break;
        }
      });

      const result = await executor.run(workflow, workflowArgs, {
        dryRun,
      });

      consola.log('');
      consola.info(`Workflow "${result.workflowName}" ${result.status}`);

      if (dryRun) {
        consola.log('');
        consola.info('Dry-run results:');
        for (const [stepId, stepResult] of result.steps) {
          const data = stepResult.result as { action: string; realm: string; params: Record<string, string> } | undefined;
          if (data) {
            consola.log(
              `  ${stepId}: ${data.action} on ${data.realm} — params: ${JSON.stringify(data.params)}`,
            );
          }
        }
      }

      process.exit(result.status === 'completed' ? 0 : 1);
    } catch (err) {
      if (err instanceof WorkflowParseError) {
        consola.error(err.message);
        for (const e of err.errors) {
          consola.error(`  - ${e}`);
        }
      } else {
        consola.error(err);
      }
      process.exit(1);
    }
  },
});

// ── list command ──────────────────────────────────────────────────────

const listCommand = defineCommand({
  meta: {
    name: 'list',
    description: 'List available workflow files',
  },
  async run() {
    try {
      const files = await readdir(WORKFLOWS_DIR);
      const ymlFiles = files.filter(
        (f) => extname(f) === '.yml' || extname(f) === '.yaml',
      );

      if (ymlFiles.length === 0) {
        consola.info('No workflow files found in ./workflows/');
        return;
      }

      consola.info(`Found ${ymlFiles.length} workflow(s):`);
      for (const file of ymlFiles) {
        consola.log(`  - ${basename(file, extname(file))}`);
      }
    } catch {
      consola.error('Could not read workflows directory');
      process.exit(1);
    }
  },
});

// ── validate command ─────────────────────────────────────────────────

const validateCommand = defineCommand({
  meta: {
    name: 'validate',
    description: 'Validate a workflow YAML file',
  },
  args: {
    file: {
      type: 'positional',
      description: 'Path to a workflow YAML file',
      required: true,
    },
  },
  async run({ args }) {
    try {
      const workflow = await parseWorkflowFile(args.file as string);
      consola.success(
        `Valid workflow: "${workflow.workflow}" (${workflow.steps.length} steps)`,
      );
    } catch (err) {
      if (err instanceof WorkflowParseError) {
        consola.error(`Invalid workflow: ${err.message}`);
        for (const e of err.errors) {
          consola.error(`  - ${e}`);
        }
      } else {
        consola.error(err);
      }
      process.exit(1);
    }
  },
});

// ── main ─────────────────────────────────────────────────────────────

const main = defineCommand({
  meta: {
    name: 'coral',
    version: '0.1.0',
    description:
      'Cross-realm workflow engine — orchestrate multi-domain automation pipelines.',
  },
  subCommands: {
    run: runCommand,
    list: listCommand,
    validate: validateCommand,
  },
});

runMain(main);
