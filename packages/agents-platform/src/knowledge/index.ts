/**
 * Knowledge Retrieval — Agent 9.2
 *
 * RAG over travel knowledge base with BM25 relevance scoring
 * and optional hybrid scoring via injectable EmbeddingProvider.
 */

import type { Agent, AgentInput, AgentOutput, AgentHealthStatus } from '@otaip/core';
import { AgentNotInitializedError, AgentInputValidationError } from '@otaip/core';
import type {
  KnowledgeInput,
  KnowledgeOutput,
  KnowledgeDocument,
  KnowledgeResult,
  KnowledgeTopic,
  KnowledgeAgentConfig,
  EmbeddingProvider,
} from './types.js';

const ALL_TOPICS: KnowledgeTopic[] = [
  'distribution',
  'ticketing',
  'settlement',
  'operations',
  'tmc',
  'fares',
  'regulations',
  'reference',
  'lodging',
];
const VALID_TOPICS = new Set<string>(ALL_TOPICS);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

/**
 * BM25 scoring parameters.
 * k1 controls term frequency saturation (1.2 is standard).
 * b controls document length normalization (0.75 is standard).
 */
const BM25_K1 = 1.2;
const BM25_B = 0.75;

/** Pre-computed corpus statistics for BM25 scoring. */
interface CorpusStats {
  /** Number of documents in the corpus. */
  docCount: number;
  /** Average document length in tokens. */
  avgDocLen: number;
  /** Number of documents containing each term. */
  docFreq: Map<string, number>;
  /** Token arrays per document, keyed by document_id. */
  docTokens: Map<string, string[]>;
}

function buildCorpusStats(documents: Map<string, KnowledgeDocument>): CorpusStats {
  const docFreq = new Map<string, number>();
  const docTokens = new Map<string, string[]>();
  let totalLen = 0;

  for (const [id, doc] of documents) {
    const tokens = tokenize(doc.content + ' ' + doc.tags.join(' '));
    docTokens.set(id, tokens);
    totalLen += tokens.length;

    const uniqueTerms = new Set(tokens);
    for (const term of uniqueTerms) {
      docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
    }
  }

  return {
    docCount: documents.size,
    avgDocLen: documents.size > 0 ? totalLen / documents.size : 0,
    docFreq,
    docTokens,
  };
}

function computeBM25(queryTokens: string[], docId: string, stats: CorpusStats): number {
  const docToks = stats.docTokens.get(docId);
  if (!docToks || docToks.length === 0) return 0;

  const docLen = docToks.length;

  // Build term frequency map for this document
  const tf = new Map<string, number>();
  for (const t of docToks) {
    tf.set(t, (tf.get(t) ?? 0) + 1);
  }

  let score = 0;
  for (const qt of queryTokens) {
    const termFreq = tf.get(qt) ?? 0;
    if (termFreq === 0) continue;

    const df = stats.docFreq.get(qt) ?? 0;
    // IDF component: log((N - df + 0.5) / (df + 0.5) + 1)
    const idf = Math.log((stats.docCount - df + 0.5) / (df + 0.5) + 1);
    // TF component with length normalization
    const tfNorm =
      (termFreq * (BM25_K1 + 1)) /
      (termFreq + BM25_K1 * (1 - BM25_B + BM25_B * (docLen / stats.avgDocLen)));
    score += idf * tfNorm;
  }

  return score;
}

/** Cosine similarity between two equal-length vectors. */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}


function excerpt(content: string, maxLen = 200): string {
  if (content.length <= maxLen) return content;
  return content.slice(0, maxLen) + '...';
}

// Fixture documents
const SEED_DOCUMENTS: Omit<KnowledgeDocument, 'indexed_at'>[] = [
  // ── Distribution (DOC001-DOC005) ──
  {
    document_id: 'DOC001',
    title: 'GDS Distribution Overview',
    topic: 'distribution',
    content:
      'The Global Distribution System connects airlines with travel agencies. Major GDS providers include Amadeus, Sabre, and Travelport. GDS enables real-time availability search, booking, and ticketing across multiple carriers.',
    tags: ['gds', 'amadeus', 'sabre'],
  },
  {
    document_id: 'DOC002',
    title: 'NDC Standard Introduction',
    topic: 'distribution',
    content:
      'New Distribution Capability is an IATA standard for airline retailing. NDC enables airlines to distribute rich content and offers directly. Versions include 17.2, 18.1, and 21.3 with increasing capability.',
    tags: ['ndc', 'iata', 'retailing'],
  },
  {
    document_id: 'DOC016',
    title: 'IATA ONE Order Concept',
    topic: 'distribution',
    content:
      'ONE Order is an IATA initiative to replace multiple document types (PNR, e-ticket, EMD) with a single order record. It aims to simplify airline retailing by treating the booking as a unified order rather than separate reservation and ticketing records.',
    tags: ['oneorder', 'iata', 'retailing'],
  },
  {
    document_id: 'DOC017',
    title: 'Offer and Order Management',
    topic: 'distribution',
    content:
      'Offer management covers the creation, pricing, and presentation of airline products to customers. Order management handles the lifecycle after purchase including servicing, modifications, and accounting. Together they form the core of modern airline retailing.',
    tags: ['offer', 'order', 'retailing'],
  },
  {
    document_id: 'DOC018',
    title: 'Content Differentiation in Distribution',
    topic: 'distribution',
    content:
      'Rich content includes seat maps, baggage visuals, Wi-Fi availability, and branded fare descriptions. NDC enables airlines to provide differentiated content beyond the plain-text formats available through traditional GDS distribution channels.',
    tags: ['rich-content', 'ndc', 'branded-fares'],
  },
  {
    document_id: 'DOC019',
    title: 'Agency Desktop and Midoffice Integration',
    topic: 'distribution',
    content:
      'Travel agency desktops aggregate content from GDS, NDC, and low-cost carrier APIs into a single workflow. Midoffice systems handle post-booking processes including invoicing, reporting, and back-office reconciliation between booking and settlement records.',
    tags: ['midoffice', 'agency', 'integration'],
  },
  // ── Ticketing (DOC003-DOC004, DOC020-DOC023) ──
  {
    document_id: 'DOC003',
    title: 'Electronic Ticketing Process',
    topic: 'ticketing',
    content:
      'Electronic tickets replaced paper tickets in 2008. An ETR contains 13-digit ticket number, coupon details, fare calculation, and tax breakdown. Conjunction tickets handle itineraries with more than 4 coupons.',
    tags: ['etr', 'coupon', 'conjunction'],
  },
  {
    document_id: 'DOC004',
    title: 'EMD Types and Usage',
    topic: 'ticketing',
    content:
      'Electronic Miscellaneous Documents come in two types. EMD-A is associated with a flight coupon for ancillaries like baggage. EMD-S is standalone for services not linked to a specific flight segment.',
    tags: ['emd', 'ancillary', 'baggage'],
  },
  {
    document_id: 'DOC020',
    title: 'Conjunction Ticket Handling',
    topic: 'ticketing',
    content:
      'When an itinerary exceeds four flight coupons, conjunction tickets are issued as linked ticket numbers. All conjunction tickets share the same fare calculation and must be processed together for exchanges, refunds, and void operations.',
    tags: ['conjunction', 'coupon', 'multi-ticket'],
  },
  {
    document_id: 'DOC021',
    title: 'Automated Ticket Revalidation',
    topic: 'ticketing',
    content:
      'Revalidation updates an existing ticket to reflect schedule changes without reissuing. It modifies the flight coupon details while preserving the original fare calculation and ticket number. Revalidation is typically used for involuntary schedule changes.',
    tags: ['revalidation', 'schedule-change', 'coupon'],
  },
  {
    document_id: 'DOC022',
    title: 'Interline E-Ticketing Agreements',
    topic: 'ticketing',
    content:
      'Interline e-ticketing agreements (IETs) allow one airline to issue electronic tickets on another airline plating stock. IATA maintains a multilateral IET and airlines also establish bilateral agreements for specific markets and routes.',
    tags: ['interline', 'iet', 'plating'],
  },
  {
    document_id: 'DOC023',
    title: 'Void and Refund Deadlines',
    topic: 'ticketing',
    content:
      'Void cancels a ticket on the same day of issuance with no financial penalty. After the void deadline passes, the ticket must go through the refund process. Refund deadlines and policies vary by fare rules, carrier, and applicable regulations.',
    tags: ['void', 'refund', 'deadline'],
  },
  // ── Settlement (DOC005-DOC006, DOC024-DOC026) ──
  {
    document_id: 'DOC005',
    title: 'BSP Settlement Process',
    topic: 'settlement',
    content:
      'The Billing and Settlement Plan manages financial settlement between airlines and travel agencies. BSP operates on periodic billing cycles with HOT files transmitted for reconciliation before remittance deadlines.',
    tags: ['bsp', 'billing', 'hot'],
  },
  {
    document_id: 'DOC006',
    title: 'ARC Weekly Settlement',
    topic: 'settlement',
    content:
      'Airlines Reporting Corporation handles settlement in the US market. ARC uses weekly settlement cycles with Interactive Agent Reports. The standard ADM dispute window is 15 days from issue date.',
    tags: ['arc', 'iar', 'adm'],
  },
  {
    document_id: 'DOC024',
    title: 'Net Remit vs Standard Commission Models',
    topic: 'settlement',
    content:
      'Standard commission involves the airline paying a percentage of the fare to the agency via BSP/ARC. Net remit eliminates the commission and instead uses a negotiated net fare where the agency adds a markup. Net remit transactions bypass the commission fields in settlement.',
    tags: ['net-remit', 'commission', 'agency'],
  },
  {
    document_id: 'DOC025',
    title: 'BSP Billing Period Cycles',
    topic: 'settlement',
    content:
      'BSP billing periods vary by market. Some markets use bi-monthly cycles while others use weekly or monthly. Each cycle includes a reporting cutoff, HOT file generation, and remittance deadline. Late payments may incur default procedures managed by IATA.',
    tags: ['bsp', 'billing-cycle', 'remittance'],
  },
  {
    document_id: 'DOC026',
    title: 'ARC IAR Dispute Handling',
    topic: 'settlement',
    content:
      'The ARC Interactive Agent Report allows agencies to review and dispute debit memos. Agencies must respond within the dispute window, providing documentation to support their position. Unresolved disputes escalate through the ARC arbitration process.',
    tags: ['arc', 'iar', 'dispute'],
  },
  // ── Operations (DOC007-DOC008, DOC027-DOC030) ──
  {
    document_id: 'DOC007',
    title: 'PNR Structure and Elements',
    topic: 'operations',
    content:
      'A Passenger Name Record contains five mandatory elements: passenger name, itinerary segments, contact information, ticketing arrangement, and received-from. PNR validation ensures all elements are present before ticketing.',
    tags: ['pnr', 'booking', 'segments'],
  },
  {
    document_id: 'DOC008',
    title: 'Queue Management in GDS',
    topic: 'operations',
    content:
      'GDS queues organize PNRs requiring attention. Ticketing queues hold PNRs approaching TTL deadlines. Schedule change queues flag carrier-initiated time changes. Priority is based on urgency and deadline proximity.',
    tags: ['queue', 'ttl', 'schedule'],
  },
  {
    document_id: 'DOC027',
    title: 'Schedule Change Management',
    topic: 'operations',
    content:
      'Airlines file schedule changes that affect existing bookings. Changes are classified by severity: minor time adjustments, equipment changes, routing changes, or flight cancellations. Each type requires different handling procedures and passenger notification.',
    tags: ['schedule-change', 'irrop', 'notification'],
  },
  {
    document_id: 'DOC028',
    title: 'Waitlist Clearance Processing',
    topic: 'operations',
    content:
      'Waitlisted segments are confirmed when seats become available in the requested booking class. GDS waitlist clearance follows priority rules set by the carrier. Agencies must monitor waitlist status and re-confirm or cancel segments before ticketing deadlines.',
    tags: ['waitlist', 'availability', 'booking-class'],
  },
  {
    document_id: 'DOC029',
    title: 'Minimum Connecting Time Rules',
    topic: 'operations',
    content:
      'Minimum connecting times (MCT) are defined per airport and vary by domestic-to-domestic, domestic-to-international, and international-to-international connections. MCT data is published by OAG and enforced at booking time to prevent illegal connections.',
    tags: ['mct', 'connection', 'oag'],
  },
  {
    document_id: 'DOC030',
    title: 'PNR History and Audit Trail',
    topic: 'operations',
    content:
      'PNR history records every modification to a booking including segment changes, ticketing actions, and remarks. The audit trail is critical for ADM defense, regulatory compliance, and dispute resolution between agencies and carriers.',
    tags: ['pnr-history', 'audit', 'compliance'],
  },
  // ── TMC (DOC009, DOC031-DOC033) ──
  {
    document_id: 'DOC009',
    title: 'TMC Operations Overview',
    topic: 'tmc',
    content:
      'Travel Management Companies handle corporate travel programs. Key functions include traveler profile management, policy enforcement, mid-office automation, and duty of care for traveling employees.',
    tags: ['tmc', 'corporate', 'policy'],
  },
  {
    document_id: 'DOC031',
    title: 'Corporate Traveler Profiles',
    topic: 'tmc',
    content:
      'Traveler profiles store personal information, travel preferences, loyalty program memberships, passport details, and corporate policy tier. Profile data is used to pre-populate bookings and enforce company travel policy at the point of sale.',
    tags: ['profile', 'corporate', 'preferences'],
  },
  {
    document_id: 'DOC032',
    title: 'Policy Compliance Automation',
    topic: 'tmc',
    content:
      'TMC systems enforce corporate travel policies by flagging out-of-policy bookings, requiring pre-trip approval workflows, and generating compliance reports. Policy rules cover fare class restrictions, advance purchase requirements, preferred vendor usage, and hotel rate caps.',
    tags: ['policy', 'compliance', 'approval'],
  },
  {
    document_id: 'DOC033',
    title: 'Unused Ticket Tracking',
    topic: 'tmc',
    content:
      'Unused tickets represent unrealized travel value that must be tracked for potential reuse or refund. TMCs monitor ticket validity periods, residual credit values, and carrier-specific reuse policies to maximize recovery of unused ticket funds for corporate clients.',
    tags: ['unused-ticket', 'credit', 'tracking'],
  },
  // ── Fares (DOC010-DOC011, DOC034-DOC038) ──
  {
    document_id: 'DOC010',
    title: 'ATPCO Fare Filing',
    topic: 'fares',
    content:
      'Airline Tariff Publishing Company manages fare data. Fares are filed with fare basis codes indicating class, restrictions, and validity. Category rules define conditions like advance purchase, minimum stay, and penalties.',
    tags: ['atpco', 'fare', 'category'],
  },
  {
    document_id: 'DOC011',
    title: 'Fare Construction Rules',
    topic: 'fares',
    content:
      'Fare construction uses NUC amounts converted via ROE rates. Mileage system validates routing against TPM and MPM values. Higher intermediate point and backhaul checks ensure fare integrity.',
    tags: ['nuc', 'roe', 'mileage'],
  },
  {
    document_id: 'DOC034',
    title: 'Fare Filing and Distribution',
    topic: 'fares',
    content:
      'Airlines file fares with ATPCO which distributes them to GDS and other subscribers. Fare records include origin, destination, carrier, fare basis, one-way/round-trip indicator, currency, amount, and effective/discontinue dates. Footnote and rule records add conditions.',
    tags: ['fare-filing', 'atpco', 'distribution'],
  },
  {
    document_id: 'DOC035',
    title: 'Fare Combinability Rules',
    topic: 'fares',
    content:
      'ATPCO Category 10 governs fare combinability. It defines which fares can be combined on the same ticket for round-trip, circle-trip, or open-jaw itineraries. End-on-end combinations allow linking separate fare components where normal construction is not possible.',
    tags: ['combinability', 'category-10', 'open-jaw'],
  },
  {
    document_id: 'DOC036',
    title: 'Tour and IT Fares',
    topic: 'fares',
    content:
      'Inclusive Tour (IT) and Bulk Inclusive Tour (BIT) fares are confidential fares sold only as part of a package. They carry specific ticket designators and endorsement restrictions. IT fares are not displayable in GDS public fare searches.',
    tags: ['tour-fare', 'it-fare', 'bulk'],
  },
  {
    document_id: 'DOC037',
    title: 'Fuel Surcharge YQ and YR',
    topic: 'fares',
    content:
      'YQ and YR are carrier-imposed surcharges filed as tax codes but determined by the airline. YQ typically represents a fuel surcharge while YR covers other carrier surcharges. These are filed via ATPCO and can vary by route, fare type, and booking class.',
    tags: ['yq', 'yr', 'surcharge'],
  },
  {
    document_id: 'DOC038',
    title: 'Circle Trip and Round-the-World Fares',
    topic: 'fares',
    content:
      'Circle trip fares cover itineraries that return to the origin via a different routing. Round-the-world fares allow travel in one direction around the globe with specified mileage allowances. Both fare types use specific construction and combinability rules.',
    tags: ['circle-trip', 'rtw', 'mileage'],
  },
  // ── Regulations (DOC012-DOC013, DOC039-DOC042) ──
  {
    document_id: 'DOC012',
    title: 'EU261 Passenger Rights',
    topic: 'regulations',
    content:
      'EU Regulation 261/2004 establishes passenger rights for flight delays, cancellations, and denied boarding. It applies to flights departing from EU airports or EU carrier flights to the EU. Compensation ranges from 250 to 600 euros.',
    tags: ['eu261', 'delay', 'compensation'],
  },
  {
    document_id: 'DOC013',
    title: 'GDPR in Travel',
    topic: 'regulations',
    content:
      'General Data Protection Regulation requires travel companies to protect personal data. Passenger information including passport numbers and contact details must be handled with appropriate security. Right to erasure applies.',
    tags: ['gdpr', 'privacy', 'pii'],
  },
  {
    document_id: 'DOC039',
    title: 'PCI DSS in Travel',
    topic: 'regulations',
    content:
      'Payment Card Industry Data Security Standard applies to all travel companies handling credit card data. GDS, airlines, and agencies must comply with PCI DSS requirements for storing, processing, and transmitting cardholder data. Tokenization is widely used for compliance.',
    tags: ['pci-dss', 'payment', 'security'],
  },
  {
    document_id: 'DOC040',
    title: 'US DOT 24-Hour Cancellation Rule',
    topic: 'regulations',
    content:
      '14 CFR §259.5(b)(4): covered airlines must allow reservations to be held at the quoted fare without payment OR cancelled without penalty for at least 24 hours after the reservation is made, if the reservation is made one week or more prior to departure. Carrier chooses one path — not both. Obligation is on airlines (not OTAs). Does not require free itinerary changes. See docs/knowledge-base/us-dot-24-hour-reservation.md.',
    tags: ['usdot', '24-hour', 'cancellation'],
  },
  {
    document_id: 'DOC041',
    title: 'IATA Resolution 830d — Baggage',
    topic: 'regulations',
    content:
      'IATA Resolution 830d governs interline baggage acceptance and through-checking procedures. It defines the most significant carrier concept for determining baggage allowance on interline itineraries and establishes rules for baggage handling across multiple operating carriers.',
    tags: ['baggage', 'iata', 'interline'],
  },
  {
    document_id: 'DOC042',
    title: 'Canada Air Passenger Protection Regulations',
    topic: 'regulations',
    content:
      'The Canadian Transportation Agency Air Passenger Protection Regulations (APPR) establish minimum obligations for airlines operating flights to, from, and within Canada. They cover denied boarding compensation, delay standards, tarmac delays, and lost baggage provisions.',
    tags: ['canada', 'appr', 'passenger-rights'],
  },
  // ── Reference (DOC014-DOC015, DOC043-DOC046) ──
  {
    document_id: 'DOC014',
    title: 'IATA Airport Codes',
    topic: 'reference',
    content:
      'IATA assigns three-letter codes to airports worldwide. Multi-airport cities like London have metro area codes. LON covers LHR, LGW, LCY, STN, LTN, and SEN airports.',
    tags: ['iata', 'airport', 'code'],
  },
  {
    document_id: 'DOC015',
    title: 'Airline Alliance Networks',
    topic: 'reference',
    content:
      'Three major airline alliances exist: Star Alliance, oneworld, and SkyTeam. Alliances enable codeshare agreements, shared lounges, and reciprocal frequent flyer benefits across member carriers.',
    tags: ['alliance', 'codeshare', 'loyalty'],
  },
  {
    document_id: 'DOC043',
    title: 'SSR Codes — Special Service Requests',
    topic: 'reference',
    content:
      'Special Service Request codes communicate passenger needs to airlines. Standard SSR codes include WCHR (wheelchair ramp), PETC (pet in cabin), MEAL types (VGML, KSML), and DOCS for passport information. SSRs are transmitted via the GDS or NDC messaging.',
    tags: ['ssr', 'special-service', 'passenger'],
  },
  {
    document_id: 'DOC044',
    title: 'OSI Messages',
    topic: 'reference',
    content:
      'Other Service Information messages are free-text remarks sent from the agency to the airline within the PNR. Unlike SSRs, OSI messages are informational and do not require action. They are commonly used for corporate identifiers, frequent flyer notifications, and booking context.',
    tags: ['osi', 'remarks', 'pnr'],
  },
  {
    document_id: 'DOC045',
    title: 'Aircraft Type Codes',
    topic: 'reference',
    content:
      'IATA and ICAO assign codes to aircraft types used in scheduling and booking systems. IATA codes are three characters (e.g., 738 for Boeing 737-800, 359 for Airbus A350-900). Equipment type affects seat availability, baggage capacity, and passenger experience.',
    tags: ['aircraft', 'equipment', 'iata'],
  },
  {
    document_id: 'DOC046',
    title: 'Currency and Exchange Rates in Travel',
    topic: 'reference',
    content:
      'IATA publishes Rate of Exchange (ROE) values monthly for fare construction purposes. BSP settlement uses banking rates that differ from ROE. Multi-currency pricing requires careful handling of rounding rules which vary by currency per IATA standards.',
    tags: ['currency', 'roe', 'exchange-rate'],
  },
  // ── Lodging (DOC047-DOC050) ──
  {
    document_id: 'DOC047',
    title: 'Property Management Systems (PMS)',
    topic: 'lodging',
    content:
      'A Property Management System is the core operational software for hotels, managing reservations, check-in/check-out, room assignments, housekeeping, and billing. Major PMS providers include Oracle OPERA, Mews, and Cloudbeds. PMS integration is essential for channel management and revenue optimization.',
    tags: ['pms', 'hotel', 'opera'],
  },
  {
    document_id: 'DOC048',
    title: 'Channel Managers and OTA Distribution',
    topic: 'lodging',
    content:
      'Channel managers synchronize hotel inventory and rates across multiple Online Travel Agencies (OTAs) and booking channels. They prevent overbooking by maintaining real-time availability updates between the PMS and distribution partners such as Booking.com, Expedia, and direct booking engines.',
    tags: ['channel-manager', 'ota', 'distribution'],
  },
  {
    document_id: 'DOC049',
    title: 'Dynamic Pricing in Hotels',
    topic: 'lodging',
    content:
      'Revenue management systems adjust hotel room rates based on demand forecasting, competitive pricing, occupancy levels, and market conditions. Dynamic pricing strategies include demand-based pricing, length-of-stay controls, and overbooking management to maximize revenue per available room (RevPAR).',
    tags: ['revenue-management', 'dynamic-pricing', 'revpar'],
  },
  {
    document_id: 'DOC050',
    title: 'Guest Loyalty Programs',
    topic: 'lodging',
    content:
      'Hotel loyalty programs reward repeat guests with points, tier status, and benefits such as room upgrades and late checkout. Major programs include Marriott Bonvoy, Hilton Honors, and IHG One Rewards. Program integration with PMS enables automatic recognition and benefit delivery at check-in.',
    tags: ['loyalty', 'rewards', 'hotel-program'],
  },
];

/** Hybrid scoring weights: BM25 vs embedding similarity. */
const BM25_WEIGHT = 0.4;
const EMBEDDING_WEIGHT = 0.6;

export class KnowledgeAgent implements Agent<KnowledgeInput, KnowledgeOutput> {
  readonly id = '9.2';
  readonly name = 'Knowledge Retrieval';
  readonly version = '0.1.0';

  private initialized = false;
  private documents = new Map<string, KnowledgeDocument>();
  private corpusStats: CorpusStats | null = null;
  private embeddingProvider: EmbeddingProvider | undefined;
  private embeddings = new Map<string, number[]>();

  constructor(config?: KnowledgeAgentConfig) {
    this.embeddingProvider = config?.embeddingProvider;
  }

  async initialize(): Promise<void> {
    this.initialized = true;
    // Seed fixture documents
    const now = new Date().toISOString();
    for (const doc of SEED_DOCUMENTS) {
      const fullDoc: KnowledgeDocument = { ...doc, indexed_at: now };
      this.documents.set(doc.document_id, fullDoc);

      if (this.embeddingProvider) {
        const embedding = await this.embeddingProvider.embed(
          fullDoc.content + ' ' + fullDoc.tags.join(' '),
        );
        this.embeddings.set(doc.document_id, embedding);
      }
    }
    this.rebuildIndex();
  }

  private rebuildIndex(): void {
    this.corpusStats = buildCorpusStats(this.documents);
  }

  async execute(input: AgentInput<KnowledgeInput>): Promise<AgentOutput<KnowledgeOutput>> {
    if (!this.initialized) throw new AgentNotInitializedError(this.id);

    const d = input.data;

    switch (d.operation) {
      case 'query':
        return this.handleQuery(d);
      case 'index_document':
        return this.handleIndex(d);
      case 'list_topics':
        return this.handleListTopics();
      case 'get_document':
        return this.handleGetDocument(d);
      default:
        throw new AgentInputValidationError(
          this.id,
          'operation',
          'Must be query, index_document, list_topics, or get_document.',
        );
    }
  }

  async health(): Promise<AgentHealthStatus> {
    if (!this.initialized) return { status: 'unhealthy', details: 'Not initialized.' };
    return { status: 'healthy' };
  }

  destroy(): void {
    this.initialized = false;
    this.documents.clear();
    this.embeddings.clear();
  }

  private async handleQuery(d: KnowledgeInput): Promise<AgentOutput<KnowledgeOutput>> {
    if (!d.query)
      throw new AgentInputValidationError(this.id, 'query', 'Required for query operation.');

    const startTime = Date.now();
    const queryTokens = tokenize(d.query);
    const maxResults = d.max_results ?? 5;

    let candidates = [...this.documents.values()];
    if (d.topic) {
      if (!VALID_TOPICS.has(d.topic))
        throw new AgentInputValidationError(this.id, 'topic', `Invalid topic: ${d.topic}`);
      candidates = candidates.filter((doc) => doc.topic === d.topic);
    }

    const stats = this.corpusStats!;

    // Compute BM25 scores
    const bm25Scores = new Map<string, number>();
    for (const doc of candidates) {
      const score = computeBM25(queryTokens, doc.document_id, stats);
      bm25Scores.set(doc.document_id, score);
    }

    // Determine if hybrid scoring is available
    const useHybrid = this.embeddingProvider !== undefined && this.embeddings.size > 0;

    let queryEmbedding: number[] | undefined;
    const embeddingScores = new Map<string, number>();
    if (useHybrid) {
      queryEmbedding = await this.embeddingProvider!.embed(d.query);
      for (const doc of candidates) {
        const docEmb = this.embeddings.get(doc.document_id);
        if (docEmb) {
          embeddingScores.set(doc.document_id, cosineSimilarity(queryEmbedding, docEmb));
        }
      }
    }

    // Combine scores
    // Normalize BM25 scores to 0-1 range for combination
    const maxBM25 = Math.max(...[...bm25Scores.values()], 0);
    const combinedScored = candidates
      .map((doc) => {
        const bm25Raw = bm25Scores.get(doc.document_id) ?? 0;
        const normalizedBM25 = maxBM25 > 0 ? bm25Raw / maxBM25 : 0;

        let finalScore: number;
        if (useHybrid) {
          const embSim = embeddingScores.get(doc.document_id) ?? 0;
          finalScore = BM25_WEIGHT * normalizedBM25 + EMBEDDING_WEIGHT * embSim;
        } else {
          finalScore = normalizedBM25;
        }

        return {
          document_id: doc.document_id,
          title: doc.title,
          topic: doc.topic,
          score: finalScore,
          bm25Raw,
          excerpt: excerpt(doc.content),
          content: doc.content,
        };
      })
      .filter((r) => r.bm25Raw > 0 || (useHybrid && (embeddingScores.get(r.document_id) ?? 0) > 0))
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);

    // Normalize final scores to 0-1
    const maxScore = combinedScored.length > 0 ? combinedScored[0]!.score : 1;
    const scored: KnowledgeResult[] = combinedScored.map((r) => ({
      document_id: r.document_id,
      title: r.title,
      topic: r.topic,
      relevance_score: maxScore > 0 ? r.score / maxScore : 0,
      excerpt: r.excerpt,
      content: r.content,
    }));

    const queryTime = Date.now() - startTime;

    return {
      data: { results: scored, query_time_ms: queryTime },
      confidence: scored.length > 0 ? scored[0]!.relevance_score : 0,
      metadata: { agent_id: this.id, results_count: scored.length, query_time_ms: queryTime },
    };
  }

  private async handleIndex(d: KnowledgeInput): Promise<AgentOutput<KnowledgeOutput>> {
    if (!d.document_id) throw new AgentInputValidationError(this.id, 'document_id', 'Required.');
    if (!d.title) throw new AgentInputValidationError(this.id, 'title', 'Required.');
    if (!d.topic || !VALID_TOPICS.has(d.topic))
      throw new AgentInputValidationError(this.id, 'topic', 'Must be a valid topic.');
    if (!d.content) throw new AgentInputValidationError(this.id, 'content', 'Required.');

    const doc: KnowledgeDocument = {
      document_id: d.document_id,
      title: d.title,
      topic: d.topic,
      content: d.content,
      tags: d.tags ?? [],
      indexed_at: new Date().toISOString(),
    };
    this.documents.set(doc.document_id, doc);
    this.rebuildIndex();

    if (this.embeddingProvider) {
      const embedding = await this.embeddingProvider.embed(
        doc.content + ' ' + doc.tags.join(' '),
      );
      this.embeddings.set(doc.document_id, embedding);
    }

    return {
      data: { document: doc, message: 'Document indexed.' },
      confidence: 1.0,
      metadata: { agent_id: this.id },
    };
  }

  private handleListTopics(): AgentOutput<KnowledgeOutput> {
    return { data: { topics: ALL_TOPICS }, confidence: 1.0, metadata: { agent_id: this.id } };
  }

  private handleGetDocument(d: KnowledgeInput): AgentOutput<KnowledgeOutput> {
    if (!d.document_id) throw new AgentInputValidationError(this.id, 'document_id', 'Required.');
    const doc = this.documents.get(d.document_id);
    if (!doc) throw new AgentInputValidationError(this.id, 'document_id', 'Document not found.');
    return { data: { document: doc }, confidence: 1.0, metadata: { agent_id: this.id } };
  }
}

export type {
  KnowledgeInput,
  KnowledgeOutput,
  KnowledgeDocument,
  KnowledgeResult,
  KnowledgeTopic,
  KnowledgeOperation,
  EmbeddingProvider,
  KnowledgeAgentConfig,
} from './types.js';
