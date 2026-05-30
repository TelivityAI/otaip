import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateCommand } from '../commands/validate.js';

/**
 * Drive the `validate` subcommand directly and capture its stdout + the
 * process exit code it sets. Restores both afterwards so one case cannot
 * leak a non-zero exit code into the vitest run.
 */
async function runValidate(args: string[]): Promise<{ out: string; exitCode: number }> {
  const lines: string[] = [];
  const log = vi.spyOn(console, 'log').mockImplementation((...a) => void lines.push(a.join(' ')));
  const err = vi.spyOn(console, 'error').mockImplementation((...a) => void lines.push(a.join(' ')));
  const prev = process.exitCode;
  process.exitCode = 0;
  try {
    await validateCommand.parseAsync(args, { from: 'user' });
    return { out: lines.join('\n'), exitCode: Number(process.exitCode ?? 0) };
  } finally {
    log.mockRestore();
    err.mockRestore();
    process.exitCode = prev;
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('otaip validate — honesty', () => {
  it('never reports PASS and exits non-zero when no contract is loaded', async () => {
    const { out, exitCode } = await runValidate([
      '--agent',
      '9.9',
      '--input',
      '{"foo":1}',
      '--json',
    ]);
    const report = JSON.parse(out) as {
      overall: string;
      failureClass: string;
      gates: Record<string, { status: string }>;
    };
    expect(report.overall).toBe('unvalidated');
    expect(report.overall).not.toBe('pass');
    expect(report.failureClass).toBe('infra');
    // The only gate we actually ran is json_parse; everything contract-backed
    // must be skipped, never asserted as a pass.
    expect(report.gates.json_parse?.status).toBe('pass');
    expect(report.gates.schema_in?.status).toBe('skipped');
    expect(report.gates.semantic_in?.status).toBe('skipped');
    expect(exitCode).not.toBe(0);
  });

  it('reports an error and exits non-zero on malformed JSON input', async () => {
    const { out, exitCode } = await runValidate([
      '--agent',
      '1.1',
      '--input',
      '{not json',
      '--json',
    ]);
    const report = JSON.parse(out) as { overall: string };
    expect(report.overall).toBe('error');
    expect(exitCode).not.toBe(0);
  });

  it('human-readable output contains no PASS verdict for an unvalidated agent', async () => {
    const { out } = await runValidate(['--agent', '3.8', '--input', '{}']);
    expect(out).toContain('UNVALIDATED');
    expect(out).not.toMatch(/Overall:\s*PASS/);
  });
});
