/**
 * Supplier registry — factory pattern for creating ConnectAdapter instances.
 *
 * By default, returned adapters are wrapped in GuardedConnectAdapter so
 * book/ticket/cancel cannot bypass the money-path executor.
 * HAIP is an exception: HaipConnectBridge embeds MoneyPathExecutor already.
 */

import { isLiveModeFromEnv, LiveSafetyError, type MoneyPathExecutorConfig } from '@otaip/core';
import type { ConnectAdapter } from '../types.js';
import { AmadeusAdapter } from './amadeus/index.js';
import { NavitaireAdapter } from './navitaire/index.js';
import { SabreAdapter } from './sabre/index.js';
import { TripProAdapter } from './trippro/index.js';
import { HaipConnectBridge } from './haip/connect-bridge.js';
import { guardAdapter, type GuardedConnectAdapter } from '../guarded-adapter.js';

export interface CreateAdapterOptions extends MoneyPathExecutorConfig {
  /**
   * When true, return the raw supplier adapter without GuardedConnectAdapter.
   * Only for unit tests of raw HTTP/mapping — never for live money paths.
   */
  readonly unguarded?: boolean;
}

type SupplierFactory = (config: unknown, options?: CreateAdapterOptions) => ConnectAdapter;

const SUPPLIER_FACTORIES: Record<string, SupplierFactory> = {};

/** Suppliers that already embed MoneyPathExecutor — do not double-wrap. */
const SELF_GUARDED = new Set<string>(['haip']);

export function registerSupplier(id: string, factory: SupplierFactory): void {
  SUPPLIER_FACTORIES[id] = factory;
}

export function createAdapter(
  supplierId: string,
  config: unknown,
  options?: CreateAdapterOptions,
): ConnectAdapter | GuardedConnectAdapter {
  const factory = SUPPLIER_FACTORIES[supplierId];
  if (!factory) {
    throw new Error(
      `Unknown supplier: ${supplierId}. Available: ${Object.keys(SUPPLIER_FACTORIES).join(', ')}`,
    );
  }
  const liveMode = options?.liveMode ?? isLiveModeFromEnv();
  if (options?.unguarded && liveMode) {
    throw new LiveSafetyError(
      'createAdapter({ unguarded: true }) is refused in live mode — money-path guard is mandatory',
    );
  }
  const execConfig: Omit<CreateAdapterOptions, 'unguarded'> = { ...(options ?? {}) };
  delete (execConfig as { unguarded?: boolean }).unguarded;
  const raw = factory(config, { ...execConfig, liveMode });
  if (options?.unguarded) return raw;
  if (SELF_GUARDED.has(supplierId)) return raw;
  return guardAdapter(raw, { ...execConfig, liveMode });
}

export function listSuppliers(): string[] {
  return Object.keys(SUPPLIER_FACTORIES);
}

// Auto-register TripPro
registerSupplier('trippro', (config) => new TripProAdapter(config));

// Auto-register Sabre
registerSupplier('sabre', (config) => new SabreAdapter(config));

// Auto-register Navitaire
registerSupplier('navitaire', (config) => new NavitaireAdapter(config));

// Auto-register Amadeus
registerSupplier('amadeus', (config) => new AmadeusAdapter(config));

// Auto-register HAIP (self-guarded via HaipAdapter MoneyPathExecutor)
registerSupplier('haip', (config, options) => {
  const { unguarded: _u, ...moneyPath } = options ?? {};
  void _u;
  return new HaipConnectBridge(config, {
    ...(options?.liveMode !== undefined ? { liveMode: options.liveMode } : {}),
    ...(options?.storeDurability !== undefined
      ? { storeDurability: options.storeDurability }
      : {}),
    moneyPath,
  });
});
