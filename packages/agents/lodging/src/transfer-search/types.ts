/** Agent 20.9 — Transfer Search (Hotelbeds Transfers wrapper). */

export interface TransferSearchAgentInput {
  originType: 'A' | 'H' | 'G';
  originCode: string;
  destinationType: 'A' | 'H' | 'G';
  destinationCode: string;
  outboundDate: string;
  outboundTime?: string;
  adults?: number;
  children?: number;
}

export interface TransferSearchAgentOffer {
  transferCode: string;
  transferType: string;
  vehicleType: string;
  price: string;
  currency: string;
}

export interface TransferSearchAgentOutput {
  offers: TransferSearchAgentOffer[];
}
