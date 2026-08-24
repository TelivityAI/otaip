# Stage 1 -- Search & Shopping Agents

**Package:** `@otaip/agents-search`

Flight availability search, schedule lookup, connection validation, fare shopping, ancillary shopping, multi-source aggregation, hotel/car search, and AI-powered travel query understanding.

---

### Agent 1.1 -- Availability Search

**ID:** `1.1`
**Class:** `AvailabilitySearch`
**Status:** Implemented

Queries distribution adapters in parallel, normalizes, deduplicates, filters, and sorts flight availability offers.

**Input (`AvailabilitySearchInput`):**

- `origin` -- origin airport/city IATA code
- `destination` -- destination airport/city IATA code
- `departure_date` -- ISO 8601 date
- `return_date?` -- ISO 8601 date for round-trip
- `passengers` -- `PassengerCount[]`
- `cabin_class?` -- `'economy' | 'premium_economy' | 'business' | 'first'`
- `direct_only?` -- only direct flights
- `max_connections?` -- 0-5
- `currency?` -- ISO 4217
- `max_results?` -- 1-200
- `sort_by?` -- `'price' | 'duration' | 'departure' | 'arrival' | 'connections'`
- `sort_order?` -- `'asc' | 'desc'`
- `sources?` -- specific adapter names to query

**Output (`AvailabilitySearchOutput`):**

- `offers` -- deduplicated, filtered, sorted `SearchOffer[]`
- `total_raw_offers` -- count before deduplication
- `source_status` -- per-adapter query status (success, count, error, response time)
- `truncated` -- whether results were capped

**Constructor:** `new AvailabilitySearch(adapters: DistributionAdapter[])`

---

### Agent 1.2 -- Schedule Lookup

**ID:** `1.2`
**Class:** `ScheduleLookup`
**Status:** Implemented

Flight schedule lookup with SSIM operating day parsing, codeshare detection, and connection discovery.

**Input (`ScheduleLookupInput`):**

- `origin` -- airport IATA code
- `destination` -- airport IATA code
- `date` -- ISO 8601 date
- `carrier?` -- filter by carrier IATA code
- `flight_number?` -- specific flight (requires carrier)
- `include_codeshares?` -- default: true
- `include_connections?` -- discover connecting options (default: false)

**Output (`ScheduleLookupOutput`):**

- `flights` -- `ScheduledFlight[]` (carrier, flight number, times, duration, schedule, codeshare info)
- `connections` -- `ConnectionOption[]` (two-leg connections with timing)
- `operates_on_date` -- whether any flights operate on the requested date

---

### Agent 1.3 -- Connection Builder

**ID:** `1.3`
**Class:** `ConnectionBuilder`
**Status:** Implemented

Validates connections against MCT (Minimum Connecting Time) rules, scores connection quality, and checks interline agreements.

MCT authority: **IATA SSIM Chapter 8** + **PSC Resolution 765** (`docs/knowledge-base/mct.md`). Curated rows live under `data/reference/mct/`. Resolution hierarchy: carrier override → airport+terminal → airport → **fail-closed** (no invented global/airport-constant table).

**Input (`ConnectionBuilderInput`):**

- `arriving_segment` -- `FlightSegment` (from `@otaip/core`)
- `departing_segment` -- `FlightSegment`
- `connection_airport` -- IATA 3-letter code
- `has_checked_bags?` -- affects MCT
- `is_interline?` -- different carriers

**Output (`ConnectionBuilderOutput`):**

- `validation` -- MCT check result (valid, available/required minutes or null when unavailable, buffer, applied rule)
- `quality` -- connection quality score 0-1 with factor breakdown
- `interline` -- interline agreement check (if different carriers)
- `warnings` -- connection warnings

---

### Agent 1.4 -- Fare Shopping

**ID:** `1.4`
**Class:** `FareShopping`
**Status:** Implemented

Multi-source fare comparison with fare basis decoding, class mapping, branded fare family grouping, and passenger type pricing.

**Input (`FareShoppingInput`):**

- `origin`, `destination`, `departure_date`, `passengers` -- same as availability search
- `cabin_class?`, `currency?`, `sources?` -- filters
- `decode_fare_basis?` -- decode fare basis codes (default: true)
- `group_by_fare_family?` -- group by basic/standard/flex/premium (default: true)

**Output (`FareShoppingOutput`):**

- `fares` -- `FareOffer[]` sorted by price, each with decoded fare basis, class info, fare family, passenger pricing
- `fare_families` -- grouped by family with cheapest/most expensive
- `total_fares` -- count
- `sources_queried` -- adapter names

**Constructor:** `new FareShopping(adapters: DistributionAdapter[])`

---

### Agent 1.5 -- Ancillary Shopping

**ID:** `1.5`
**Class:** `AncillaryShoppingAgent`
**Status:** Implemented

Searches for available ancillaries (baggage, seats, meals, lounge, Wi-Fi, priority) via an injectable adapter.

**Input (`AncillaryShoppingInput`):**

- `segments` -- flight segments (origin, destination, flight number, date, carrier)
- `passengers` -- passenger references with type (ADT/CHD/INF)
- `pnrRef?` -- PNR reference
- `requestedCategories?` -- filter by category (BAGGAGE, SEAT, MEAL, etc.)

**Output (`AncillaryShoppingOutput`):**

- `ancillaries` -- `AncillaryOffer[]` with RFIC/RFISC codes, pricing, availability
- `notSupportedByAdapter` -- true if no adapter configured
- `currency` -- pricing currency

---

### Agent 1.6 -- Multi-Source Aggregator

**ID:** `1.6`
**Class:** `MultiSourceAggregatorAgent`
**Status:** Implemented

Aggregates search results from multiple adapters with deduplication, price comparison, and ranking.

**Input (`MultiSourceInput`):**

- `results` -- `AdapterSearchResult[]` (adapter name, flights, errors, response time)
- `deduplicationStrategy` -- `'keep_cheapest' | 'keep_all' | 'keep_first'`
- `rankBy` -- `'price' | 'duration' | 'stops'`
- `maxResults?` -- limit output count

**Output (`MultiSourceOutput`):**

- `flights` -- `NormalizedFlight[]` with sources, lowest price, all prices across adapters
- `totalRaw` -- raw count before dedup
- `totalAfterDedup` -- final count
- `adapterSummary` -- per-adapter stats

---

### Agent 1.7 -- Hotel & Car Search

**ID:** `1.7`
**Class:** `HotelCarSearchAgent`
**Status:** Implemented (adapter-dependent)

Car rental search (and, pending a deferred car-only migration, hotel) via pluggable adapters. Returns empty results when no adapters configured.

**Routing ownership:** hotel search intent is owned by Hotel Search Aggregator (20.1) for all hotel queries -- standalone or within a trip. 1.7 owns car rental; it may compose with 20.1 for a combined hotel+car trip but does not own hotel intent. Route hotel queries to 20.1.

**Input (`HotelCarSearchInput`):**

- `operation` -- `'searchHotels' | 'searchCars'`
- `hotel?` -- hotel search params (destination, dates, rooms, adults, star rating, max rate)
- `car?` -- car search params (pickup/dropoff location and times, category, driver age)

**Output (`HotelCarSearchOutput`):**

- `hotelResults?` -- hotel offers with rate, room type, cancellation policy
- `carResults?` -- car offers with category, supplier, daily/total rate, features

---

### Agent 1.8 -- AI Travel Advisor

**ID:** `1.8`
**Class:** `AITravelAdvisorAgent`
**Status:** Implemented

Natural language travel query understanding with injectable LLM provider. Parses user queries into structured search parameters.

**Input (`TravelAdvisorInput`):**

- `query` -- natural language travel query
- `travelerContext?` -- preferences (cabin, budget, preferred airlines, passenger counts)

**Output (`TravelAdvisorOutput`):**

- `searchParameters` -- extracted origin, destination, dates, trip type, cabin, passengers, flexible dates
- `summary` -- natural language summary of interpreted query
- `intent` -- `'flight_search' | 'hotel_search' | 'destination_recommendation' | 'price_check' | 'trip_planning' | 'unknown'`

**Constructor:** `new AITravelAdvisorAgent({ llmProvider, maxTokens?, temperature? })`

---

### Agent 1.9 -- Offer Evaluator

**ID:** `1.9`
**Package:** `@otaip/core` (not in agents-search)
**Class:** `OfferEvaluatorAgent`
**Status:** Implemented

Deterministic offer evaluation engine. Scores and ranks flight offers based on traveler profile, constraints, and configurable scoring weights.

**Input (`OfferEvaluatorRequest`):**

- `offers` -- `EvaluatorOffer[]` with price, itinerary (segments, duration, connections)
- `constraints?` -- latest arrival, prefer direct, max connections, price ceiling, preferred/blacklisted carriers
- `profile?` -- `'BUSINESS_TIME_CRITICAL' | 'BUSINESS_PRICE_CONSTRAINED' | 'LEISURE' | 'CORPORATE_POLICY' | 'CUSTOM'`
- `weights?` -- custom scoring weights (time_buffer, price, connection_quality, journey_duration)

**Output (`OfferEvaluatorResponse`):**

- Scored and ranked offers with structured explanation for LLM translation
