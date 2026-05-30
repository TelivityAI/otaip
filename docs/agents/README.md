# OTAIP Agent Index

All agents in the Open Travel AI Platform, organized by stage.

## Stage Files

| Stage | Domain | File |
|-------|--------|------|
| 0 | Reference Data | [stage-0-reference.md](stage-0-reference.md) |
| 1 | Search & Shopping | [stage-1-search.md](stage-1-search.md) |
| 2 | Pricing | [stage-2-pricing.md](stage-2-pricing.md) |
| 3 | Booking | [stage-3-booking.md](stage-3-booking.md) |
| 4 | Ticketing | [stage-4-ticketing.md](stage-4-ticketing.md) |
| 5 | Exchange & Change | [stage-5-exchange.md](stage-5-exchange.md) |
| 6 | Settlement | [stage-6-settlement.md](stage-6-settlement.md) |
| 7 | Reconciliation | [stage-7-reconciliation.md](stage-7-reconciliation.md) |
| 8 | TMC (Travel Management Company) | [stage-8-tmc.md](stage-8-tmc.md) |
| 9 | Platform | [stage-9-platform.md](stage-9-platform.md) |
| 20 | Lodging | [stage-20-lodging.md](stage-20-lodging.md) |

## All Agents

| ID | Name | Stage | Status |
|----|------|-------|--------|
| 0.1 | Airport/City Code Resolver | 0 -- Reference Data | Implemented |
| 0.2 | Airline Code & Alliance Mapper | 0 -- Reference Data | Implemented |
| 0.3 | Fare Basis Code Decoder | 0 -- Reference Data | Implemented |
| 0.4 | Class of Service Mapper | 0 -- Reference Data | Implemented |
| 0.5 | Equipment Type Resolver | 0 -- Reference Data | Implemented |
| 0.6 | Currency & Tax Code Resolver | 0 -- Reference Data | Implemented |
| 0.7 | Country Regulatory Resolver | 0 -- Reference Data | Implemented |
| 1.1 | Availability Search | 1 -- Search & Shopping | Implemented |
| 1.2 | Schedule Lookup | 1 -- Search & Shopping | Implemented |
| 1.3 | Connection Builder | 1 -- Search & Shopping | Implemented |
| 1.4 | Fare Shopping | 1 -- Search & Shopping | Implemented |
| 1.5 | Ancillary Shopping | 1 -- Search & Shopping | Implemented |
| 1.6 | Multi-Source Aggregator | 1 -- Search & Shopping | Implemented |
| 1.7 | Hotel & Car Search | 1 -- Search & Shopping | Implemented |
| 1.8 | AI Travel Advisor | 1 -- Search & Shopping | Implemented |
| 1.9 | Offer Evaluator | 1 -- Search & Shopping | Implemented |
| 2.1 | Fare Rule Agent | 2 -- Pricing | Implemented |
| 2.2 | Fare Construction | 2 -- Pricing | Implemented |
| 2.3 | Tax Calculation | 2 -- Pricing | Implemented |
| 2.4 | Offer Builder | 2 -- Pricing | Implemented |
| 2.5 | Corporate Policy Validation | 2 -- Pricing | Implemented |
| 2.6 | Dynamic Pricing | 2 -- Pricing | Coming Soon |
| 2.7 | Revenue Management | 2 -- Pricing | Coming Soon |
| 3.1 | GDS/NDC Router | 3 -- Booking | Implemented |
| 3.2 | PNR Builder | 3 -- Booking | Implemented |
| 3.3 | PNR Validation | 3 -- Booking | Implemented |
| 3.4 | Queue Management | 3 -- Booking | Implemented |
| 3.5 | API Abstraction | 3 -- Booking | Implemented |
| 3.6 | Order Management | 3 -- Booking | Implemented |
| 3.7 | Payment Processing | 3 -- Booking | Implemented |
| 4.1 | Ticket Issuance | 4 -- Ticketing | Implemented |
| 4.2 | EMD Management | 4 -- Ticketing | Implemented |
| 4.3 | Void Agent | 4 -- Ticketing | Implemented |
| 4.4 | Itinerary Delivery | 4 -- Ticketing | Implemented |
| 4.5 | Document Verification | 4 -- Ticketing | Implemented |
| 5.1 | Change Management | 5 -- Exchange & Change | Implemented |
| 5.2 | Exchange/Reissue | 5 -- Exchange & Change | Implemented |
| 5.3 | Involuntary Rebook | 5 -- Exchange & Change | Implemented |
| 5.4 | Disruption Response | 5 -- Exchange & Change | Coming Soon |
| 5.5 | Self-Service Rebooking | 5 -- Exchange & Change | Implemented |
| 5.6 | Waitlist Management | 5 -- Exchange & Change | Implemented |
| 6.1 | Refund Processing | 6 -- Settlement | Implemented |
| 6.2 | ADM Prevention | 6 -- Settlement | Implemented |
| 6.3 | ADM/ACM Processing | 6 -- Settlement | Implemented |
| 6.4 | Customer Communication | 6 -- Settlement | Implemented |
| 6.5 | Feedback & Complaint | 6 -- Settlement | Implemented |
| 6.6 | Loyalty & Mileage | 6 -- Settlement | Implemented |
| 7.1 | BSP Reconciliation | 7 -- Reconciliation | Implemented |
| 7.2 | ARC Reconciliation | 7 -- Reconciliation | Implemented |
| 7.3 | Commission Management | 7 -- Reconciliation | Implemented |
| 7.4 | Interline Settlement | 7 -- Reconciliation | Coming Soon |
| 7.5 | Financial Reporting | 7 -- Reconciliation | Implemented |
| 7.6 | Revenue Accounting | 7 -- Reconciliation | Implemented |
| 8.1 | Traveler Profile | 8 -- TMC | Implemented |
| 8.2 | Corporate Account | 8 -- TMC | Implemented |
| 8.3 | Mid-Office Automation | 8 -- TMC | Implemented |
| 8.4 | Reporting & Analytics | 8 -- TMC | Implemented |
| 8.5 | Duty of Care | 8 -- TMC | Implemented |
| 9.1 | Orchestrator | 9 -- Platform | Implemented |
| 9.2 | Knowledge Retrieval | 9 -- Platform | Implemented |
| 9.3 | Monitoring & Alerting | 9 -- Platform | Implemented |
| 9.4 | Audit & Compliance | 9 -- Platform | Implemented |
| 9.5 | Plugin Manager | 9 -- Platform | Implemented |
| 9.6 | Performance Audit | 9 -- Platform | Implemented |
| 9.7 | Routing Audit | 9 -- Platform | Implemented |
| 9.8 | Recommendation | 9 -- Platform | Implemented |
| 9.9 | Alert | 9 -- Platform | Implemented |
| 20.1 | Hotel Search Aggregator | 20 -- Lodging | Implemented |
| 20.2 | Property Deduplication | 20 -- Lodging | Implemented |
| 20.3 | Hotel Content Normalization | 20 -- Lodging | Implemented |
| 20.4 | Hotel Rate Comparison | 20 -- Lodging | Implemented |
| 20.5 | Hotel Booking | 20 -- Lodging | Implemented |
| 20.6 | Hotel Modification & Cancellation | 20 -- Lodging | Implemented |
| 20.7 | Confirmation Verification | 20 -- Lodging | Implemented |
