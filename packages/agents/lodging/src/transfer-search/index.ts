/**
 * Agent 20.9 — Transfer Search
 *
 * Thin typed wrapper around Hotelbeds Transfers search for Tarmac route→fill.
 */
import type { Agent, AgentInput, AgentOutput } from '@otaip/core';
import { AgentNotInitializedError, AgentInputValidationError } from '@otaip/core';
import type { TransferSearchAgentInput, TransferSearchAgentOutput } from './types.js';

export type {
  TransferSearchAgentInput,
  TransferSearchAgentOutput,
  TransferSearchAgentOffer,
} from './types.js';

export interface TransferSearchAdapter {
  searchTransfers(req: Record<string, unknown>): Promise<
    Array<{
      rateKey?: string;
      transferType?: string;
      vehicle?: { name?: string };
      price?: { totalAmount?: string; currencyId?: string };
    }>
  >;
}

export class TransferSearchAgent
  implements Agent<TransferSearchAgentInput, TransferSearchAgentOutput>
{
  readonly id = '20.9';
  readonly name = 'Transfer Search';
  readonly version = '0.1.0';

  private initialized = false;
  constructor(private readonly adapter?: TransferSearchAdapter) {}

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async execute(
    input: AgentInput<TransferSearchAgentInput>,
  ): Promise<AgentOutput<TransferSearchAgentOutput>> {
    if (!this.initialized) throw new AgentNotInitializedError(this.id);
    const d = input.data;
    if (!d.originCode || !d.destinationCode || !d.outboundDate) {
      throw new AgentInputValidationError(
        this.id,
        'originCode/destinationCode/outboundDate',
        'Required.',
      );
    }
    if (!this.adapter) {
      return {
        data: { offers: [] },
        metadata: { note: 'No adapter injected — envelope validated only.' },
      };
    }
    const raw = await this.adapter.searchTransfers({
      language: 'en',
      fromType: d.originType,
      fromCode: d.originCode,
      toType: d.destinationType,
      toCode: d.destinationCode,
      outbound: `${d.outboundDate}T${d.outboundTime ?? '12:00:00'}`,
      adults: d.adults ?? 1,
      children: d.children ?? 0,
    });
    const offers = raw.slice(0, 3).map((o, i) => ({
      transferCode: String(o.rateKey ?? `xfer-${i}`),
      transferType: String(o.transferType ?? 'PRIVATE'),
      vehicleType: String(o.vehicle?.name ?? 'Car'),
      price: String(o.price?.totalAmount ?? '0'),
      currency: String(o.price?.currencyId ?? 'EUR'),
    }));
    return { data: { offers } };
  }

  async healthCheck() {
    return { status: 'healthy' as const, agentId: this.id };
  }
}
