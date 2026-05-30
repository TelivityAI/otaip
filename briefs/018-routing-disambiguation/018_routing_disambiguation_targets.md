# Routing Disambiguation Targets (from v0.6.1 eval confusion matrix)

> **Provenance copy.** This is the input brief for the routing-disambiguation truth task,
> preserved here so the deliverable is self-contained. The authored truth lives in
> [`routing_truth.jsonl`](./routing_truth.jsonl) and [`routing_truth_summary.md`](./routing_truth_summary.md).
> Source eval (referenced by the brief): `eval-runs/v0_6_1/routing_accuracy.json` —
> **not present in this repo** (see Handoff note below).

Format: `expected -> wrongly_routed_to (count)`. These are the agent boundaries the model
can't tell apart. Fixing them = the v0.6.2 routing fix.

## GROUP A — Orchestrator over-capture (HIGHEST LEVERAGE — one boundary fixes ~5 agents)
The model defaults specific intents to the meta-agent 9.1 (Orchestrator):
  6.2 -> 9.1 (10) | 7.1 -> 9.1 (7) | 8.1 -> 9.1 (3) | 1.1 -> 9.1 (3) | 8.3 -> 9.1 (2)
TRUTH: what belongs to 9.1 (multi-step orchestration) vs a single specific agent.
6.2 / 7.1 / 8.1 / 1.1 / 8.3 are single-purpose — they should NOT route to 9.1.

## GROUP B — Booking/pricing cluster: the original 14 scatter into new booking siblings
  3.2 (PNR-builder)   -> 3.6 (5), 3.3 (3), 20.6 (2)
  3.1 (GDS/NDC-router)-> 3.5 (5), 3.7 (2)
  2.4 (offer-builder) -> 3.7 (5), 3.6 (2)
  3.8 (PNR-retrieval) -> 3.6 (4), 20.7 (4)
  2.1 (fare-rule)     -> 3.3 (4), 3.7 (2)
  4.1 (ticket-issue)  -> 4.3 (3), 3.7 (3), 3.3 (2)
TRUTH: boundary between each original (3.1/3.2/3.8/2.4/2.1/4.1) and the new siblings
(3.3 PNR-validation, 3.4 queue-mgmt, 3.5 API-abstraction, 3.6 order-mgmt, 3.7 payment,
20.6, 20.7, 4.3).

## GROUP C — Disruption/rebooking 5.x family
  5.5 (self-service rebook) -> 5.2 (4), 5.3 (3), 5.1 (3)
  5.6 (waitlist)            -> 3.7 (3), 3.5 (3), 3.4 (2)
TRUTH: 5.5 vs 5.1/5.2/5.3 (voluntary vs involuntary vs change-mgmt); 5.6 (waitlist) vs
queue/booking siblings.

## GROUP D — 9.x family internal confusion
  9.3 -> 9.9 (7) | 9.8 -> 9.9 (6) | 9.7 -> 8.4 (6) | 9.7 -> 9.4 (3) | 8.5 -> 9.5 (3)
TRUTH: boundaries within the 9.x agents (and 9.x vs 8.x).

## GROUP E — Reference (0.x) + search (1.x)
  0.3 (fare-basis)  -> 0.6 (4), 3.3 (2)   |  0.1 (airport) -> 0.6 (2)
  1.8 -> 1.4 (4)    |  1.1 -> 1.6/1.3 (2 each)  |  1.2/1.3/1.4 -> 1.5
TRUTH: 0.6 (currency/tax) is swallowing reference lookups; 1.x search agents blur into 1.5.

## GROUP F — STALE-LABEL CHECK (may be RELABEL, not retrain)
  1.7 (Hotel & Car Search) -> 20.1 (4), 20.2 (3)
20.1 = "Hotel Search Aggregator" (new). QUESTION: is hotel traffic legitimately 20.1's now?
If yes -> update the bench label, do NOT train against it.

---

# HANDOFF NOTE → Tarmac data-gen (read before expanding seeds)

**This task produced the *truth* only. No model training happened.** Deliverables:
1. [`routing_truth.jsonl`](./routing_truth.jsonl) — 116 labeled hard-negative utterances.
   Schema per record: `{utterance, correct_agent_id, confused_with, group, why}`.
   Exact path to pull from:
   `briefs/018-routing-disambiguation/routing_truth.jsonl`
2. [`routing_truth_summary.md`](./routing_truth_summary.md) — boundaries, RELABEL list,
   ambiguity flags, doc-drift finding.

**Confirmed about the expansion step (the brief asked us to verify, not assume):**
- There is **no `generate_v06_corpus.py` in this (OTAIP) repo** — and no `briefs/018_*`
  input file, no `eval-runs/v0_6_1/routing_accuracy.json`, and no "Tarmac" code here. OTAIP
  is a TypeScript/Node monorepo; a Python corpus generator is a *Tarmac-side* artifact.
- Per the brief, `generate_v06_corpus.py` is **route+fill** (slot-filling existing
  utterances), **not utterance-expansion**. So it will **not** turn these 123 seeds into a
  diverse corpus on its own. **Tarmac needs a separate utterance-expansion step** that
  takes each seed and generates paraphrase/variant utterances *preserving the label and the
  `why` boundary* (and especially preserving the hard negatives). **Building that expansion
  step is out of scope for this OTAIP task** — it belongs in Tarmac's pipeline.
- **Bench relabels:** apply directly per `routing_truth_summary.md`. **Exception:** the
  `1.7 → 20.1` hotel-only relabel is **BLOCKED** pending an OTAIP owner decision on whether
  20.1 supersedes 1.7's hotel role (the contracts don't say). Do not relabel those cases
  until that's resolved; the car→1.7, multi-source-lodging→20.1, and dedup→20.2 cases are
  safe and already encoded.

**Authoring basis:** all labels use each agent's binding `readonly id`. The 9.x JSDoc/README
ids are stale (off-by-one) but verified cosmetic — they never reached the model or bench.
