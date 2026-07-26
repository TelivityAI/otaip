/** Agent 20.8 — Activity Search (Hotelbeds Activities wrapper). */

export interface ActivitySearchAgentInput {
  destination: string;
  dateFrom: string;
  dateTo: string;
  adults?: number;
  childrenAges?: number[];
  category?: string;
}

export interface ActivitySearchAgentOffer {
  activityCode: string;
  name: string;
  fromPrice: string;
  currency: string;
}

export interface ActivitySearchAgentOutput {
  offers: ActivitySearchAgentOffer[];
}
