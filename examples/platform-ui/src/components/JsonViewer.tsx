import { useMemo, useState } from 'react';

interface JsonViewerProps {
  value: unknown;
  /** Visible label on the copy button. Defaults to "Copy JSON". */
  copyLabel?: string;
}

export default function JsonViewer({ value, copyLabel = 'Copy JSON' }: JsonViewerProps) {
  const [copied, setCopied] = useState(false);
  const json = useMemo(() => safeStringify(value), [value]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(json);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          } catch {
            // Browsers without clipboard permission fall back to selection.
            const range = document.createRange();
            const pre = document.getElementById('json-viewer-pre');
            if (pre) {
              range.selectNode(pre);
              window.getSelection()?.removeAllRanges();
              window.getSelection()?.addRange(range);
            }
          }
        }}
        className="absolute right-2 top-2 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 shadow-sm hover:bg-slate-50"
      >
        {copied ? 'Copied' : copyLabel}
      </button>
      <pre
        id="json-viewer-pre"
        className="max-h-[60vh] overflow-auto rounded-md bg-slate-950 px-4 py-3 pr-20 text-xs leading-5 text-slate-100"
      >
        {json}
      </pre>
    </div>
  );
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch (err) {
    return `[unserializable: ${err instanceof Error ? err.message : String(err)}]`;
  }
}
