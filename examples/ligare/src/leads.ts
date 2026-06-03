/**
 * Minimal lead capture for the demo: append "connect your inventory" inquiries
 * to a local JSONL file. (For production, swap this for Supabase or email.)
 */

import { appendFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const LEADS_FILE = join(here, '..', 'leads.jsonl');

export async function recordLead(email: string, note?: string): Promise<void> {
  const entry = { email, note: note ?? '', ts: new Date().toISOString() };
  await appendFile(LEADS_FILE, `${JSON.stringify(entry)}\n`, 'utf8');
  console.log(`[lead] ${email}`);
}
