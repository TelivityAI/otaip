/**
 * Supplier registry — factory pattern for creating ConnectAdapter instances.
 *
 * By default, returned adapters are wrapped in GuardedConnectAdapter so
 * book/ticket/cancel cannot bypass the money-path executor.
 */

import type { ConnectAdapter } from '../types.js';
import { AmadeusAdapter } from './amadeus/index.js';
import { NavitaireAdapter } from './navitaire/index.js';
import { SabreAdapter } from './sabre/index.js';
import { TripProAdapter } from './trippro/index.js';
import { guardAdapter, type GuardedConnectAdapter } from '../guarded-adapter.js';
import type { MoneyPathExecutorConfig } from '@otaip/core';

const SUPPLIER_FACTORIES: Record<string, (config: unknown) => ConnectAdapter> = {};

export function registerSupplier(id: string, factory: (config: unknown) => ConnectAdapter): void {
  SUPPLIER_FACTORIES[id] = factory;
}

export interface CreateAdapterOptions extends MoneyPathExecutorConfig {
  /**
   * When true, return the raw supplier adapter without GuardedConnectAdapter.
   * Only for unit tests of raw HTTP/mapping — never for live money paths.
   */
  readonly unguarded?: boolean;
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
  const raw = factory(config);
  if (options?.unguarded) return raw;
  const { unguarded: _u, ...execConfig } = options ?? {};
  return guardAdapter(raw, execConfig);
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
