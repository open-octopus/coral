/**
 * Cross-realm context injection for workflow execution.
 *
 * WorkflowContext holds results from completed steps and provides
 * utilities for accessing realm-scoped data and template interpolation.
 */

import type { StepDefinition, StepResult } from './types.js';

export class WorkflowContext {
  private results = new Map<string, StepResult>();
  private stepDefs = new Map<string, StepDefinition>();

  constructor(stepDefinitions: StepDefinition[]) {
    for (const step of stepDefinitions) {
      this.stepDefs.set(step.id, step);
    }
  }

  /** Record the result of a completed step. */
  setStepResult(stepId: string, result: StepResult): void {
    this.results.set(stepId, result);
  }

  /** Get the result of a completed step, or undefined if not yet completed. */
  getStepResult(stepId: string): StepResult | undefined {
    return this.results.get(stepId);
  }

  /** Get all completed step results that belong to a specific realm. */
  getRealmData(realm: string): StepResult[] {
    const realmResults: StepResult[] = [];
    for (const [stepId, result] of this.results) {
      const def = this.stepDefs.get(stepId);
      if (def?.realm === realm) {
        realmResults.push(result);
      }
    }
    return realmResults;
  }

  /** Get all completed step results. */
  getAllResults(): Map<string, StepResult> {
    return new Map(this.results);
  }

  /**
   * Replace {{var}} placeholders in a template string with values from args.
   * Supports nested references like {{step.result}} for accessing step outputs.
   */
  interpolate(template: string, args: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
      if (key in args) {
        return args[key];
      }
      return `{{${key}}}`;
    });
  }

  /**
   * Interpolate all params in a record, replacing {{var}} with values from args.
   */
  interpolateParams(
    params: Record<string, string> | undefined,
    args: Record<string, string>,
  ): Record<string, string> {
    if (!params) return {};
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(params)) {
      result[key] = this.interpolate(value, args);
    }
    return result;
  }
}
