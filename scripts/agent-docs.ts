/**
 * Load human-authored agent descriptions from docs/ for the agent map.
 * Sources: docs/agents.md (one-liners) + docs/agents/stage-*.md (purpose,
 * input, output, example). Do not invent domain text — only what is written.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface AgentDoc {
  readonly id: string;
  readonly className?: string;
  /** One-line from docs/agents.md (or stage purpose fallback). */
  readonly summary: string;
  /** Longer purpose prose from stage docs. */
  readonly purpose?: string;
  readonly input?: string;
  readonly output?: string;
  /** How to use — example code or usage prose from stage docs. */
  readonly usage?: string;
  readonly status?: string;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#10003;/g, '✓')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Parse catalog table rows from docs/agents.md → id → summary. */
export function parseAgentsCatalog(markdown: string): Map<string, { className: string; name: string; summary: string }> {
  const out = new Map<string, { className: string; name: string; summary: string }>();
  for (const line of markdown.split('\n')) {
    const m = line.match(
      /^\|\s*(\d+\.\d+)\s*\|\s*`?([^`|]*)`?\s*\|\s*([^|]+)\|\s*([^|]+)\|/,
    );
    if (!m) continue;
    const id = m[1]!;
    const className = m[2]!.trim();
    const name = m[3]!.trim();
    const summary = decodeHtmlEntities(m[4]!.trim());
    if (!summary) continue;
    out.set(id, { className, name, summary });
  }
  return out;
}

interface StageBlock {
  id: string;
  className?: string;
  status?: string;
  purpose?: string;
  input?: string;
  output?: string;
  usage?: string;
}

/** Split stage markdown into per-agent blocks keyed by **ID:** `x.y`. */
export function parseStageDoc(markdown: string): StageBlock[] {
  const blocks: StageBlock[] = [];
  // Split on ### Agent headings
  const parts = markdown.split(/^### Agent /m);
  for (const part of parts.slice(1)) {
    const idMatch = part.match(/\*\*ID:\*\*\s*`(\d+\.\d+)`/);
    if (!idMatch) continue;
    const id = idMatch[1]!;
    const classMatch = part.match(/\*\*Class:\*\*\s*`([^`]+)`/);
    const statusMatch = part.match(/\*\*Status:\*\*\s*([^\n]+)/);

    // Purpose: prose after Status line until **Input or **Output or **Example or --- or next heading
    const afterStatus = part.split(/\*\*Status:\*\*[^\n]*\n+/)[1] ?? '';
    const purposeMatch = afterStatus.match(
      /^([\s\S]*?)(?=\n\*\*Input|\n\*\*Output|\n\*\*Example|\n---|\n### |\n## |$)/,
    );
    let purpose = purposeMatch?.[1]?.trim() ?? '';
    // Drop leading blank / non-prose
    purpose = purpose
      .split('\n')
      .filter((l) => !l.startsWith('**') && !l.startsWith('```'))
      .join('\n')
      .trim();

    const sectionStop = String.raw`\n\*\*(?:Input|Output|Example|Constructor)|\n---|\n### |\n## |$`;
    const inputMatch = part.match(
      new RegExp(String.raw`\*\*Input[^*]*\*\*:?\s*\n([\s\S]*?)(?=${sectionStop})`),
    );
    const outputMatch = part.match(
      new RegExp(String.raw`\*\*Output[^*]*\*\*:?\s*\n([\s\S]*?)(?=${sectionStop})`),
    );
    const exampleMatch = part.match(
      /\*\*Example:\*\*\s*\n```(?:typescript|ts|js)?\n([\s\S]*?)```/,
    );
    const constructorMatch = part.match(/\*\*Constructor:\*\*\s*([^\n]+)/);

    const input = inputMatch?.[1]?.trim();
    const output = outputMatch?.[1]?.trim();
    let usage: string | undefined;
    if (exampleMatch?.[1]) {
      usage = exampleMatch[1].trim();
    } else if (constructorMatch?.[1]) {
      const ctor = constructorMatch[1].trim().replace(/^`|`$/g, '');
      usage = `${ctor} Then call initialize() and execute({ data }).`;
    }

    blocks.push({
      id,
      ...(classMatch ? { className: classMatch[1]!.trim() } : {}),
      ...(statusMatch ? { status: statusMatch[1]!.trim() } : {}),
      ...(purpose ? { purpose } : {}),
      ...(input ? { input } : {}),
      ...(output ? { output } : {}),
      ...(usage ? { usage } : {}),
    });
  }
  return blocks;
}

function formatBulletBlock(raw: string): string {
  return raw
    .split('\n')
    .map((l) => l.replace(/^\s*-\s*/, '').trim())
    .filter(Boolean)
    .join('\n');
}

/** Normalize for duplicate detection (catalog vs stage prose often differ by a period). */
export function proseKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s.]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isSameProse(a: string, b: string): boolean {
  return Boolean(a) && Boolean(b) && proseKey(a) === proseKey(b);
}

/** First prose paragraph from a source file's leading block comment. */
export function summaryFromSourceJsdoc(source: string): string | undefined {
  const m = source.match(/^\/\*\*([\s\S]*?)\*\//);
  if (!m) return undefined;
  const lines = m[1]!
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, '').trim())
    .filter((l) => l && !/^Agent\s+\d+\.\d+/i.test(l));
  const para = lines.join(' ').replace(/\s+/g, ' ').trim();
  return para || undefined;
}

export interface AgentSourceRef {
  readonly id: string;
  readonly source_path: string;
}

/**
 * Build id → AgentDoc from repo docs. Optionally fill gaps from agent
 * source-file JSDoc (still authored text — not invented).
 */
export function loadAgentDocs(
  repoRoot: string,
  sources: readonly AgentSourceRef[] = [],
): Record<string, AgentDoc> {
  const catalogPath = join(repoRoot, 'docs/agents.md');
  const agentsDir = join(repoRoot, 'docs/agents');
  const catalog = existsSync(catalogPath)
    ? parseAgentsCatalog(readFileSync(catalogPath, 'utf8'))
    : new Map();

  const stageBlocks = new Map<string, StageBlock>();
  if (existsSync(agentsDir)) {
    for (const file of readdirSync(agentsDir)) {
      if (!/^stage-.*\.md$/.test(file)) continue;
      const blocks = parseStageDoc(readFileSync(join(agentsDir, file), 'utf8'));
      for (const b of blocks) stageBlocks.set(b.id, b);
    }
  }

  const ids = new Set([
    ...catalog.keys(),
    ...stageBlocks.keys(),
    ...sources.map((s) => s.id),
  ]);
  const out: Record<string, AgentDoc> = {};
  const sourceById = new Map(sources.map((s) => [s.id, s.source_path]));

  for (const id of ids) {
    const cat = catalog.get(id);
    const stage = stageBlocks.get(id);
    let summary = cat?.summary || stage?.purpose || '';

    if (!summary) {
      const rel = sourceById.get(id);
      if (rel) {
        const abs = join(repoRoot, rel);
        if (existsSync(abs)) {
          summary = summaryFromSourceJsdoc(readFileSync(abs, 'utf8')) ?? '';
        }
      }
    }
    if (!summary && !stage?.purpose && !stage?.usage && !stage?.input) continue;

    const doc: AgentDoc = {
      id,
      summary: summary || stage?.purpose || '',
      ...(cat?.className || stage?.className
        ? { className: (cat?.className || stage?.className)! }
        : {}),
      ...(stage?.input ? { input: formatBulletBlock(stage.input) } : {}),
      ...(stage?.output ? { output: formatBulletBlock(stage.output) } : {}),
      ...(stage?.usage ? { usage: stage.usage } : {}),
      ...(stage?.status ? { status: stage.status } : {}),
    };

    // Only keep purpose when it adds real information beyond the catalog summary.
    if (
      stage?.purpose &&
      !isSameProse(stage.purpose, doc.summary) &&
      stage.purpose.length > (doc.summary?.length ?? 0) + 20
    ) {
      out[id] = { ...doc, purpose: stage.purpose };
    } else {
      out[id] = doc;
    }

    // Default how-to when stage docs have I/O but no example/constructor
    if (!out[id]!.usage && (out[id]!.input || out[id]!.output)) {
      out[id] = {
        ...out[id]!,
        usage:
          'Call initialize(), then execute({ data }) with the input fields below. See the agent source and stage doc for typed schemas.',
      };
    } else if (!out[id]!.usage && out[id]!.summary) {
      out[id] = {
        ...out[id]!,
        usage:
          'Call initialize(), then execute({ data }). See source_path for the typed input/output contract.',
      };
    }
  }

  return out;
}
