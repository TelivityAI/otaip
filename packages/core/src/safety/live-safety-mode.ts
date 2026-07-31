/**
 * LiveSafetyMode — refuse irreversible money-path operations when the
 * runtime is backed by non-durable (in-memory/mock) stores.
 */

export type StoreDurability = 'ephemeral' | 'durable';

export interface LiveSafetyModeConfig {
  /**
   * When true, irreversible operations require durable stores.
   * Typically enabled via OTAIP_MODE=live or NODE_ENV=production.
   */
  readonly liveMode: boolean;
  /** Durability of the command / effect / order stores in use. */
  readonly storeDurability: StoreDurability;
  /** When true, mock adapters / synthetic ticketing are in use. */
  readonly mockAdapters?: boolean;
}

export class LiveSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LiveSafetyError';
  }
}

export function isLiveModeFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const mode = (env['OTAIP_MODE'] ?? '').toLowerCase();
  if (mode === 'live' || mode === 'production') return true;
  if (mode === 'test' || mode === 'demo' || mode === 'dev') return false;
  return (env['NODE_ENV'] ?? '').toLowerCase() === 'production';
}

/**
 * Assert that irreversible ops are allowed under the current safety config.
 * Throws {@link LiveSafetyError} when live mode is paired with ephemeral/mock stores.
 */
export function assertIrreversibleAllowed(config: LiveSafetyModeConfig): void {
  if (!config.liveMode) return;

  if (config.storeDurability === 'ephemeral') {
    throw new LiveSafetyError(
      'Live mode refuses irreversible operations with ephemeral (in-memory) stores. ' +
        'Inject a durable CompareAndSwapPersistenceAdapter / CommandStore / EffectLedger.',
    );
  }

  if (config.mockAdapters) {
    throw new LiveSafetyError(
      'Live mode refuses irreversible operations while mock adapters or synthetic ticketing are enabled.',
    );
  }
}

export class LiveSafetyMode {
  constructor(private readonly config: LiveSafetyModeConfig) {}

  get liveMode(): boolean {
    return this.config.liveMode;
  }

  assertIrreversibleAllowed(): void {
    assertIrreversibleAllowed(this.config);
  }
}
