import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';

const root = resolve(__dirname, '../..');

function readWorkflow(path: string): unknown {
  return YAML.parse(readFileSync(resolve(root, path), 'utf-8'));
}

function collectSteps(value: unknown): Array<Record<string, unknown>> {
  if (!value || typeof value !== 'object') return [];

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectSteps(item));
  }

  const record = value as Record<string, unknown>;
  const ownSteps = Array.isArray(record.steps)
    ? record.steps.filter((step): step is Record<string, unknown> => Boolean(step) && typeof step === 'object')
    : [];

  return [
    ...ownSteps,
    ...Object.values(record).flatMap((item) => collectSteps(item)),
  ];
}

describe('brand packaging workflows', () => {
  it.each([
    '.github/workflows/release.yml',
    '.github/workflows/package-win-manual.yml',
  ])('%s passes the matrix brand through Vite codegen', (workflowPath) => {
    const workflow = readWorkflow(workflowPath);
    const buildSteps = collectSteps(workflow).filter((step) => step.name === 'Build Vite bundles');

    expect(buildSteps.length).toBeGreaterThan(0);
    for (const step of buildSteps) {
      expect(step).toMatchObject({
        env: {
          BRAND: '${{ matrix.brand }}',
        },
        run: 'pnpm run build:vite',
      });
    }
  });
});
