import { describe, it, expect } from 'vitest';
import {
  parseWorkflowString,
  parseWorkflowFile,
  interpolateParams,
  WorkflowParseError,
} from './parser.js';

const VALID_YAML = `
workflow: test-workflow
trigger: "do something with {{target}}"
steps:
  - id: step-a
    realm: pet
    action: feed
    params:
      target: "{{target}}"
  - id: step-b
    action: summarize
    depends_on:
      - step-a
`;

const MINIMAL_YAML = `
workflow: minimal
trigger: "hello"
steps:
  - id: only
    action: greet
`;

describe('parseWorkflowString', () => {
  it('parses a valid workflow YAML', () => {
    const def = parseWorkflowString(VALID_YAML);
    expect(def.workflow).toBe('test-workflow');
    expect(def.trigger).toBe('do something with {{target}}');
    expect(def.steps).toHaveLength(2);
    expect(def.steps[0].id).toBe('step-a');
    expect(def.steps[0].realm).toBe('pet');
    expect(def.steps[0].params?.target).toBe('{{target}}');
    expect(def.steps[1].depends_on).toEqual(['step-a']);
  });

  it('parses a minimal workflow', () => {
    const def = parseWorkflowString(MINIMAL_YAML);
    expect(def.workflow).toBe('minimal');
    expect(def.steps).toHaveLength(1);
  });

  it('throws WorkflowParseError for invalid YAML syntax', () => {
    expect(() => parseWorkflowString('{{{')).toThrow(WorkflowParseError);
  });

  it('throws WorkflowParseError for missing required fields', () => {
    const yaml = `
steps:
  - id: a
    action: b
`;
    expect(() => parseWorkflowString(yaml)).toThrow(WorkflowParseError);
  });

  it('throws WorkflowParseError for missing dependency references', () => {
    const yaml = `
workflow: bad
trigger: test
steps:
  - id: a
    action: do
    depends_on:
      - nonexistent
`;
    expect(() => parseWorkflowString(yaml)).toThrow(WorkflowParseError);
  });

  it('throws WorkflowParseError for circular dependencies', () => {
    const yaml = `
workflow: circular
trigger: test
steps:
  - id: a
    action: do
    depends_on:
      - b
  - id: b
    action: do
    depends_on:
      - a
`;
    expect(() => parseWorkflowString(yaml)).toThrow(WorkflowParseError);
  });

  it('includes error details in WorkflowParseError', () => {
    try {
      parseWorkflowString('not: valid: yaml: content: [');
    } catch (err) {
      expect(err).toBeInstanceOf(WorkflowParseError);
      expect((err as WorkflowParseError).errors.length).toBeGreaterThan(0);
    }
  });

  it('parses workflow with approval and retry', () => {
    const yaml = `
workflow: complex
trigger: do it
steps:
  - id: risky
    action: deploy
    approval: required
    timeout: 30000
    retry:
      max: 3
      delay: 1000
`;
    const def = parseWorkflowString(yaml);
    expect(def.steps[0].approval).toBe('required');
    expect(def.steps[0].timeout).toBe(30000);
    expect(def.steps[0].retry?.max).toBe(3);
    expect(def.steps[0].retry?.delay).toBe(1000);
  });
});

describe('parseWorkflowFile', () => {
  it('throws for nonexistent file', async () => {
    await expect(
      parseWorkflowFile('/nonexistent/path.yml'),
    ).rejects.toThrow(WorkflowParseError);
  });
});

describe('interpolateParams', () => {
  it('replaces {{var}} placeholders', () => {
    const result = interpolateParams(
      { dest: '{{destination}}', dur: '{{duration}}' },
      { destination: 'Tokyo', duration: '5 days' },
    );
    expect(result).toEqual({ dest: 'Tokyo', dur: '5 days' });
  });

  it('leaves unknown placeholders intact', () => {
    const result = interpolateParams(
      { val: '{{unknown}}' },
      { other: 'value' },
    );
    expect(result).toEqual({ val: '{{unknown}}' });
  });

  it('handles mixed text and placeholders', () => {
    const result = interpolateParams(
      { msg: 'Going to {{place}} for {{time}}!' },
      { place: 'Paris', time: '3 days' },
    );
    expect(result).toEqual({ msg: 'Going to Paris for 3 days!' });
  });

  it('returns empty object for undefined params', () => {
    const result = interpolateParams(undefined, { a: 'b' });
    expect(result).toEqual({});
  });

  it('handles params with no placeholders', () => {
    const result = interpolateParams(
      { static: 'no vars here' },
      { a: 'b' },
    );
    expect(result).toEqual({ static: 'no vars here' });
  });
});
