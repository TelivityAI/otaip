# OTAIP Developer Guide

Build typed, testable agents for the travel industry.

---

## Agent Interface

Every agent implements `Agent<TInput, TOutput>` from `@otaip/core`:

```typescript
import type { Agent, AgentInput, AgentOutput, AgentHealthStatus } from '@otaip/core';

export class MyAgent implements Agent<MyInput, MyOutput> {
  readonly id = '0.1';
  readonly name = 'My Agent';
  readonly version = '0.1.0';

  private initialized = false;

  async initialize(): Promise<void> {
    // Load reference data, validate datasets
    this.initialized = true;
  }

  async execute(input: AgentInput<MyInput>): Promise<AgentOutput<MyOutput>> {
    // Core logic — deterministic, no side effects
    return {
      data: result,
      confidence: 1.0,
      metadata: { agent_id: this.id },
    };
  }

  async health(): Promise<AgentHealthStatus> {
    return { status: 'healthy' };
  }
}
```

### Input/Output Wrappers

```typescript
// Input wraps your domain type with optional metadata
interface AgentInput<T> {
  data: T;
  metadata?: Record<string, unknown>;
}

// Output wraps your result with confidence and warnings
interface AgentOutput<T> {
  data: T;
  confidence?: number;          // 0-1
  metadata?: Record<string, unknown>;
  warnings?: string[];
}

// Health check
interface AgentHealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  details?: string;
}
```

---

## File Structure

Every agent follows this layout:

```
{agent-name}/
  types.ts              # All input/output/internal types
  {logic-module}.ts     # Core business logic (pure functions)
  index.ts              # Agent class (implements Agent interface)
  __tests__/
    {agent-name}.test.ts  # Vitest tests
```

- **types.ts** defines the public interface. Other agents depend on these types.
- **Logic modules** contain pure functions. No state, no I/O.
- **index.ts** wires types + logic into the Agent lifecycle.
- **Tests** encode domain knowledge as assertions.

---

## Building a New Agent

### Step 1: Write the spec

Create a YAML spec in `agents/specs/` that defines inputs, outputs, types, and test cases. The spec is the contract — implement to the spec, not around it.

### Step 2: Define types

```typescript
// types.ts
export interface MyAgentInput {
  query: string;
  options?: { maxResults?: number };
}

export interface MyAgentOutput {
  results: Result[];
  totalMatches: number;
}
```

### Step 3: Implement logic

Keep business logic in separate modules as pure functions:

```typescript
// resolver.ts
export function resolve(query: string, data: Dataset[]): Result[] {
  // Pure function — no this, no state, no I/O
}
```

### Step 4: Implement the agent

```typescript
// index.ts
export class MyAgent implements Agent<MyAgentInput, MyAgentOutput> {
  readonly id = 'X.Y';
  readonly name = 'My Agent';
  readonly version = '0.1.0';

  private initialized = false;
  private data: Dataset[] = [];

  async initialize(): Promise<void> {
    this.data = loadDataset();  // Load once
    this.initialized = true;
  }

  async execute(input: AgentInput<MyAgentInput>): Promise<AgentOutput<MyAgentOutput>> {
    if (!this.initialized) {
      throw new AgentNotInitializedError(this.id);
    }
    // Validate, execute, return
  }

  async health(): Promise<AgentHealthStatus> {
    if (!this.initialized) {
      return { status: 'unhealthy', details: 'Not initialized' };
    }
    return { status: 'healthy' };
  }
}
```

### Step 5: Export from package index

```typescript
// src/index.ts
export { MyAgent } from './my-agent/index.js';
export type { MyAgentInput, MyAgentOutput } from './my-agent/types.js';
```

---

## Error Handling

Use the error classes from `@otaip/core`:

| Error | When to throw |
|-------|---------------|
| `AgentNotInitializedError` | `execute()` called before `initialize()` |
| `AgentInputValidationError` | Bad input — specify field and reason |
| `AgentDataUnavailableError` | External data source is down or missing |
| `AgentError` | Base class for custom domain errors |

```typescript
import { AgentInputValidationError } from '@otaip/core';

if (!data.code) {
  throw new AgentInputValidationError(this.id, 'code', 'Airport code is required');
}
```

---

## Confidence Scores

Every `AgentOutput` includes an optional `confidence` field (0-1):

| Score | Meaning |
|-------|---------|
| 1.0 | Exact match or deterministic result |
| 0.7-0.9 | High-confidence fuzzy match |
| 0.5-0.7 | Partial match, may need review |
| 0 | Not found or no match |

Downstream agents can use confidence to filter, sort, or escalate results.

---

## Adapter Pattern

Distribution adapters connect agents to external data sources:

```typescript
// Hotel source adapter (lodging domain)
interface HotelSourceAdapter {
  readonly id: string;
  readonly name: string;
  search(input: HotelSearchInput): Promise<RawHotelResult[]>;
}
```

Adapters are injected at construction time. Mock adapters for tests, live adapters for production:

```typescript
// In tests
const agent = new HotelSearchAgent({ adapters: [new MockAmadeusAdapter()] });

// In production
const agent = new HotelSearchAgent({
  adapters: [
    new AmadeusHotelAdapter({ apiKey: process.env.AMADEUS_KEY }),
    new HotelbedsAdapter({ apiKey: process.env.HOTELBEDS_KEY }),
  ],
});
```

---

## Adding to the Monorepo

### New package

1. Create `packages/agents/{domain}/package.json`:
   ```json
   {
     "name": "@otaip/agents-{domain}",
     "version": "0.1.0",
     "type": "module",
     "main": "./dist/index.js",
     "types": "./dist/index.d.ts",
     "scripts": {
       "build": "tsup src/index.ts --format esm --dts"
     },
     "dependencies": {
       "@otaip/core": "workspace:*"
     }
   }
   ```

2. Add to `pnpm-workspace.yaml` packages glob if not already covered.

3. Create `tsconfig.json` extending `../../tsconfig.base.json`.

4. Add test paths to root `vitest.config.ts` include array.

### Conventions

- **Package naming**: `@otaip/agents-{domain}` for agent packages, `@otaip/adapter-{source}` for adapters
- **TypeScript**: Strict mode, no `any` without justification
- **Financial math**: Use string-based decimal arithmetic (no floating point for currency)
- **Testing**: Vitest. Mock external APIs. Tests must encode domain knowledge.
- **ESM**: All packages use `"type": "module"` with `.js` extensions in imports

---

## Agent system presentation

OTAIP ships a first-party **agent architecture presentation** for browsing the ~77 discovered agents by stage, with edges from Orchestrator workflows and agent-package workspace deps.

| Artifact | Role |
|---|---|
| `agents.manifest.json` | Authoritative agent roster |
| `agents.graph.json` | Nodes + workflow/package edges for navigation |
| `docs/agent-map.html` | Standalone agent system page (no build step) |
| `docs/assets/telivity/` | Brand logos/favicon from [telivity.app](https://telivity.app) (navy/teal/Montserrat) |
| Platform UI → Map | Same graph via `GET /api/platform/agent-graph` |

Regenerate all three (plus the HTML) with:

```bash
pnpm gen:manifest
```

CI runs `pnpm gen:manifest --check` so stale artifacts fail the build.

This is **not** a travel-domain knowledge graph and is unrelated to Graphify / RAG. Do not treat map edges as fare, tax, or lodging domain logic — they only describe how agents are wired in this repo.

---

## Testing

```bash
# Run all tests
pnpm test

# Run tests for a specific package
pnpm vitest run packages/agents/lodging/

# Run with verbose output
pnpm vitest run --reporter=verbose

# Typecheck
pnpm typecheck

# Lint
pnpm lint
```

### Test guidelines

- Mock external APIs — never call real APIs from tests
- Test domain edge cases, not just happy paths
- A test that says `expect(result).toBeDefined()` is not a test
- Include confidence score assertions
- Test error cases (missing input, uninitialized agent)

---

## Quick Reference

| Command | Description |
|---------|-------------|
| `pnpm install` | Install dependencies |
| `pnpm test` | Run all tests |
| `pnpm typecheck` | TypeScript strict check |
| `pnpm lint` | ESLint + Prettier |
| `pnpm gen:manifest` | Regenerate agent manifest, graph, and `docs/agent-map.html` |
| `pnpm run data:download` | Download reference datasets |

Requirements: Node 20+, pnpm 9+.
