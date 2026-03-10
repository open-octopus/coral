/**
 * DAG builder, topological sort, cycle detection, and validation utilities.
 */

import type { DAG, StepDefinition } from './types.js';

/**
 * Build a DAG adjacency list from step definitions.
 * Maps each step ID to its list of dependencies (depends_on).
 */
export function buildDAG(steps: StepDefinition[]): DAG {
  const dag: DAG = new Map();

  for (const step of steps) {
    dag.set(step.id, step.depends_on ?? []);
  }

  return dag;
}

/**
 * Perform a topological sort on the DAG using Kahn's algorithm.
 * Returns the step IDs in a valid execution order.
 * Throws if the DAG contains cycles.
 */
export function topologicalSort(dag: DAG): string[] {
  // Compute in-degree for each node
  const inDegree = new Map<string, number>();
  for (const [node] of dag) {
    inDegree.set(node, 0);
  }
  for (const [, deps] of dag) {
    for (const dep of deps) {
      // dep is a dependency, meaning there is an edge dep -> node
      // But we track in-degree of the node that has the dependency
    }
  }

  // Build forward adjacency: for each dep -> list of nodes that depend on it
  const forward = new Map<string, string[]>();
  for (const [node] of dag) {
    forward.set(node, []);
  }
  for (const [node, deps] of dag) {
    for (const dep of deps) {
      const list = forward.get(dep);
      if (list) {
        list.push(node);
      }
    }
    inDegree.set(node, deps.length);
  }

  // Start with nodes that have no dependencies
  const queue: string[] = [];
  for (const [node, degree] of inDegree) {
    if (degree === 0) {
      queue.push(node);
    }
  }

  const sorted: string[] = [];

  while (queue.length > 0) {
    // Sort for deterministic output
    queue.sort();
    const current = queue.shift()!;
    sorted.push(current);

    const dependents = forward.get(current) ?? [];
    for (const dependent of dependents) {
      const newDegree = (inDegree.get(dependent) ?? 1) - 1;
      inDegree.set(dependent, newDegree);
      if (newDegree === 0) {
        queue.push(dependent);
      }
    }
  }

  if (sorted.length !== dag.size) {
    throw new Error('DAG contains a cycle — topological sort is impossible');
  }

  return sorted;
}

/**
 * Detect cycles in the DAG using DFS.
 * Returns the cycle path as an array of step IDs, or null if no cycle exists.
 */
export function detectCycles(dag: DAG): string[] | null {
  const WHITE = 0; // unvisited
  const GRAY = 1; // in current path
  const BLACK = 2; // fully processed

  const color = new Map<string, number>();
  for (const [node] of dag) {
    color.set(node, WHITE);
  }

  const parent = new Map<string, string | null>();

  function dfs(node: string): string[] | null {
    color.set(node, GRAY);

    const deps = dag.get(node) ?? [];
    for (const dep of deps) {
      if (color.get(dep) === GRAY) {
        // Found a cycle: reconstruct the path
        const cycle = [dep, node];
        let current = node;
        while (current !== dep) {
          const p = parent.get(current);
          if (p === null || p === undefined) break;
          cycle.push(p);
          current = p;
        }
        return cycle.reverse();
      }

      if (color.get(dep) === WHITE) {
        parent.set(dep, node);
        const result = dfs(dep);
        if (result) return result;
      }
    }

    color.set(node, BLACK);
    return null;
  }

  for (const [node] of dag) {
    if (color.get(node) === WHITE) {
      parent.set(node, null);
      const result = dfs(node);
      if (result) return result;
    }
  }

  return null;
}

/**
 * Get steps that are ready to execute: all their dependencies are in the completed set.
 */
export function getReadySteps(
  dag: DAG,
  completed: Set<string>,
  running?: Set<string>,
): string[] {
  const ready: string[] = [];
  const runningSet = running ?? new Set();

  for (const [node, deps] of dag) {
    if (completed.has(node) || runningSet.has(node)) {
      continue;
    }
    const allDepsMet = deps.every((dep) => completed.has(dep));
    if (allDepsMet) {
      ready.push(node);
    }
  }

  return ready.sort();
}

/**
 * Validate the DAG: check for cycles and missing dependency references.
 * Returns an array of error messages (empty if valid).
 */
export function validateDAG(steps: StepDefinition[]): string[] {
  const errors: string[] = [];
  const stepIds = new Set(steps.map((s) => s.id));

  // Check for missing dependency references
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

  // Check for cycles
  if (errors.length === 0) {
    const dag = buildDAG(steps);
    const cycle = detectCycles(dag);
    if (cycle) {
      errors.push(`Circular dependency detected: ${cycle.join(' -> ')}`);
    }
  }

  return errors;
}
