import { describe, it, expect } from 'vitest';
import {
  LiveSafetyError,
  LiveSafetyMode,
  MutationKillSwitch,
  MutationKillSwitchError,
  assertIrreversibleAllowed,
  isLiveModeFromEnv,
} from '../index.js';

describe('LiveSafetyMode', () => {
  it('detects live mode from env', () => {
    expect(isLiveModeFromEnv({ OTAIP_MODE: 'live' })).toBe(true);
    expect(isLiveModeFromEnv({ OTAIP_MODE: 'demo' })).toBe(false);
    expect(isLiveModeFromEnv({ NODE_ENV: 'production' })).toBe(true);
  });

  it('refuses irreversible ops with ephemeral stores in live mode', () => {
    expect(() =>
      assertIrreversibleAllowed({
        liveMode: true,
        storeDurability: 'ephemeral',
      }),
    ).toThrow(LiveSafetyError);
  });

  it('refuses mock adapters in live mode', () => {
    expect(() =>
      assertIrreversibleAllowed({
        liveMode: true,
        storeDurability: 'durable',
        mockAdapters: true,
      }),
    ).toThrow(LiveSafetyError);
  });

  it('allows durable non-mock in live mode', () => {
    const mode = new LiveSafetyMode({
      liveMode: true,
      storeDurability: 'durable',
      mockAdapters: false,
    });
    expect(() => mode.assertIrreversibleAllowed()).not.toThrow();
  });
});

describe('MutationKillSwitch', () => {
  it('blocks mutations when engaged', () => {
    const sw = new MutationKillSwitch();
    sw.engage('incident');
    expect(sw.isEngaged).toBe(true);
    expect(() => sw.assertMutationsAllowed()).toThrow(MutationKillSwitchError);
    sw.release();
    expect(() => sw.assertMutationsAllowed()).not.toThrow();
  });
});
