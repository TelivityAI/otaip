/**
 * FileEventStore — a durable, append-only `EventStore`.
 *
 * Writes each {@link OtaipEvent} as one JSON line (JSONL) to a file, so a
 * run's trace survives process restarts and can be read back by a *different*
 * process / API call than the one that produced it. This is the "durable"
 * half of the trace deliverable.
 *
 * It does NOT reimplement query/aggregate — it composes the in-memory store
 * from `@otaip/core` for those, replaying the file into it on `open()`. There
 * is exactly one filter/aggregate implementation in the platform, and it lives
 * in core.
 *
 * Events never contain credentials or PII (see {@link OtaipEvent}); this store
 * writes events verbatim and adds nothing, so the file is safe to persist.
 */

import { appendFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AggregateResult, EventFilter, EventStore, OtaipEvent, TimeWindow } from '@otaip/core';
import { InMemoryEventStore } from '@otaip/core';

export class FileEventStore implements EventStore {
  private readonly mem = new InMemoryEventStore();

  private constructor(private readonly filePath: string) {}

  /**
   * Open (or create) a JSONL event log at `filePath`, replaying any existing
   * events into the in-memory index. Use this instead of `new`.
   */
  static async open(filePath: string): Promise<FileEventStore> {
    const store = new FileEventStore(filePath);
    await mkdir(dirname(filePath), { recursive: true });
    if (existsSync(filePath)) {
      const raw = await readFile(filePath, 'utf-8');
      for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        try {
          await store.mem.append(JSON.parse(trimmed) as OtaipEvent);
        } catch {
          // Skip a corrupt/partial trailing line rather than failing the read.
        }
      }
    }
    return store;
  }

  /** Append durably: in-memory index first, then the on-disk log. */
  async append(event: OtaipEvent): Promise<void> {
    await this.mem.append(event);
    await appendFile(this.filePath, `${JSON.stringify(event)}\n`, 'utf-8');
  }

  query(filter: EventFilter): Promise<OtaipEvent[]> {
    return this.mem.query(filter);
  }

  aggregate(
    metric: string,
    window: TimeWindow,
    filter?: Omit<EventFilter, 'window'>,
  ): Promise<AggregateResult> {
    return this.mem.aggregate(metric, window, filter);
  }

  /** Absolute or relative path this store persists to. */
  get path(): string {
    return this.filePath;
  }
}
