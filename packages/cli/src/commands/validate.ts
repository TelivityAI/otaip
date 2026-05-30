/**
 * CLI command: otaip validate
 *
 * Dry-run pipeline validation for a specific agent. Today the CLI only
 * depends on `@otaip/core`, so it cannot load an agent's `AgentContract`
 * (those live in the per-agent packages). It therefore CANNOT actually run
 * the schema / semantic gates here.
 *
 * Honesty rule: never report a gate as `PASS` when it was not run. A
 * non-validation must NOT read as a pass — that is the "infra error
 * masquerading as a result" failure mode. So when no contract is available
 * the gates are reported as `skipped`, the overall verdict is `unvalidated`
 * (failureClass `infra`), and the process exits non-zero so scripts and CI
 * cannot mistake it for success.
 *
 * The only thing this command genuinely checks is that `--input` is valid
 * JSON.
 *
 * TODO: once `agents.manifest.json` records each agent's package + export,
 * resolve and dynamically import the contract here to run the real
 * schema_in / semantic_in gates and report true per-gate results.
 */

import { Command } from 'commander';

type GateStatus = 'pass' | 'fail' | 'skipped';

interface GateReport {
  readonly status: GateStatus;
  readonly note: string;
}

/** Exit codes — distinct so callers can tell the two failure modes apart. */
const EXIT_BAD_JSON = 1;
const EXIT_UNVALIDATED = 2;

const CONTRACT_REQUIRED =
  'requires the agent contract — not reachable from the CLI yet (see `otaip agents`)';

export const validateCommand = new Command('validate')
  .description('Dry-run pipeline validation for an agent')
  .requiredOption('--agent <id>', 'Agent ID (e.g. 1.1, 3.8)')
  .requiredOption('--input <json>', 'JSON input to validate')
  .option('--json', 'Output as JSON')
  .option('--verbose', 'Show detailed gate results')
  .action(async (opts: {
    agent: string;
    input: string;
    json?: boolean;
    verbose?: boolean;
  }) => {
    let parsedInput: unknown;
    try {
      parsedInput = JSON.parse(opts.input);
    } catch {
      const errorMsg = `Invalid JSON input: ${opts.input}`;
      if (opts.json) {
        console.log(
          JSON.stringify(
            { agent_id: opts.agent, overall: 'error', failureClass: 'infra', message: errorMsg },
            null,
            2,
          ),
        );
      } else {
        console.error(`  Error: ${errorMsg}`);
      }
      process.exitCode = EXIT_BAD_JSON;
      return;
    }

    // We can only honestly assert the one thing we actually did: parse JSON.
    // Every contract-backed gate is `skipped` because no contract is loaded.
    const gates: Record<string, GateReport> = {
      json_parse: { status: 'pass', note: 'Input is valid JSON' },
      schema_in: { status: 'skipped', note: `Schema validation ${CONTRACT_REQUIRED}` },
      semantic_in: { status: 'skipped', note: `Semantic validation ${CONTRACT_REQUIRED}` },
      intent_lock: { status: 'skipped', note: 'No active pipeline session' },
      cross_agent: { status: 'skipped', note: 'No active pipeline session' },
      confidence: { status: 'skipped', note: 'Dry-run — agent not executed' },
      action_class: { status: 'skipped', note: 'Dry-run — agent not executed' },
    };

    // Overall is `unvalidated` (not `pass`) precisely because the gates that
    // would reflect on the input were never run. failureClass mirrors the
    // orchestrator's classification: this is infra, not a validation result.
    const report = {
      agent_id: opts.agent,
      input: parsedInput,
      gates,
      overall: 'unvalidated' as const,
      failureClass: 'infra' as const,
      message: 'JSON is well-formed, but no contract was loaded — nothing was validated.',
    };

    process.exitCode = EXIT_UNVALIDATED;

    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log('');
    console.log(`  Validate Agent ${opts.agent}`);
    console.log('  ' + '-'.repeat(56));

    for (const [gate, result] of Object.entries(report.gates)) {
      const status = result.status.toUpperCase();
      console.log(`  ${status.padEnd(8)} ${gate.padEnd(16)} ${result.note}`);
    }

    console.log('  ' + '-'.repeat(56));
    console.log(`  Overall: ${report.overall.toUpperCase()} (${report.failureClass})`);
    console.log(`  ${report.message}`);
    console.log('');

    if (opts.verbose) {
      console.log('  Input:');
      console.log('  ' + JSON.stringify(parsedInput, null, 2).split('\n').join('\n  '));
      console.log('');
    }
  });
