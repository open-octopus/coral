/**
 * Persists workflow run state to disk for resume support.
 *
 * Stores runs as JSON files under ~/.coral/runs/{runId}.json.
 */

import { mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { WorkflowRun, StepResult, WorkflowStatus } from './types.js';

const RUNS_DIR = join(homedir(), '.coral', 'runs');

interface SerializedRun {
  id: string;
  workflowName: string;
  args: Record<string, string>;
  steps: [string, StepResult][];
  status: WorkflowStatus;
  startedAt: number;
  completedAt?: number;
  /** Original workflow file path for resume */
  workflowFile?: string;
}

export class RunStore {
  private dir: string;

  constructor(dir?: string) {
    this.dir = dir ?? RUNS_DIR;
    mkdirSync(this.dir, { recursive: true });
  }

  /** Save a workflow run to disk. */
  save(run: WorkflowRun, workflowFile?: string): void {
    const serialized: SerializedRun = {
      id: run.id,
      workflowName: run.workflowName,
      args: run.args,
      steps: [...run.steps.entries()],
      status: run.status,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      workflowFile,
    };
    const filePath = join(this.dir, `${run.id}.json`);
    writeFileSync(filePath, JSON.stringify(serialized, null, 2));
  }

  /** Load a workflow run from disk. Returns null if not found. */
  load(runId: string): { run: WorkflowRun; workflowFile?: string } | null {
    const filePath = join(this.dir, `${runId}.json`);
    if (!existsSync(filePath)) return null;

    const data = JSON.parse(readFileSync(filePath, 'utf-8')) as SerializedRun;
    const run: WorkflowRun = {
      id: data.id,
      workflowName: data.workflowName,
      args: data.args,
      steps: new Map(data.steps),
      status: data.status,
      startedAt: data.startedAt,
      completedAt: data.completedAt,
    };

    return { run, workflowFile: data.workflowFile };
  }

  /** List all saved run IDs with basic info. */
  list(): Array<{ id: string; workflowName: string; status: WorkflowStatus; startedAt: number }> {
    if (!existsSync(this.dir)) return [];
    const files = readdirSync(this.dir).filter((f) => f.endsWith('.json'));
    return files.map((f) => {
      const data = JSON.parse(readFileSync(join(this.dir, f), 'utf-8')) as SerializedRun;
      return {
        id: data.id,
        workflowName: data.workflowName,
        status: data.status,
        startedAt: data.startedAt,
      };
    });
  }

  /** Delete a saved run. */
  delete(runId: string): boolean {
    const filePath = join(this.dir, `${runId}.json`);
    if (!existsSync(filePath)) return false;
    unlinkSync(filePath);
    return true;
  }
}
