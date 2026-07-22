// Small presentational primitives shared across the Telescope inspector, styled via the Telescope
// CSS section (styles.css). All read-only.
import JsonView from 'react18-json-view'
import 'react18-json-view/src/style.css'
import type { Tone } from '../lib/telescope-format'

/** A pill badge (HTTP status / log level / job status / …) coloured by tone. */
export function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }): JSX.Element {
  return <span className={`tele-badge tone-${tone}`}>{children}</span>
}

/** A dimmed "nothing here" hint for empty detail sections. */
export function EmptyHint({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="tele-empty-hint">{children}</div>
}

type KV = [label: string, value: unknown]

/** A label/value table (headers, entry metadata, …). Null/empty values are skipped. */
export function KeyVals({ rows }: { rows: KV[] }): JSX.Element {
  const shown = rows.filter(([, v]) => v !== null && v !== undefined && v !== '')
  if (shown.length === 0) return <EmptyHint>No details</EmptyHint>
  return (
    <div className="tele-kv">
      {shown.map(([label, value]) => (
        <div className="tele-kv-row" key={label}>
          <span className="tele-kv-label">{label}</span>
          <span className="tele-kv-value">{typeof value === 'string' ? value : String(value)}</span>
        </div>
      ))}
    </div>
  )
}

/** Collapsible, read-only JSON (reuses the app's react18-json-view, themed via --json-* vars).
 *  Primitives/empty degrade to a hint or a plain code line. */
export function JsonBlock({ value, collapsed = 2 }: { value: unknown; collapsed?: number }): JSX.Element {
  if (value === null || value === undefined) return <EmptyHint>Empty</EmptyHint>
  if (typeof value !== 'object') return <Code text={String(value)} />
  if (Array.isArray(value) && value.length === 0) return <EmptyHint>Empty</EmptyHint>
  if (!Array.isArray(value) && Object.keys(value as object).length === 0) return <EmptyHint>Empty</EmptyHint>
  return (
    <div className="tele-json json-view">
      <JsonView src={value as object} collapsed={collapsed} enableClipboard={false} displaySize={false} />
    </div>
  )
}

/** A monospace, scrollable, escaped code/text block (SQL, response body, HTML source, output). */
export function Code({ text }: { text: string }): JSX.Element {
  return <pre className="tele-code">{text}</pre>
}

/** Render a response/JSON-ish string: pretty-print if it parses as JSON, else raw escaped text. */
export function MaybeJson({ text }: { text: string }): JSX.Element {
  try {
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed === 'object') return <JsonBlock value={parsed} />
  } catch {
    /* not JSON — fall through to raw */
  }
  return <Code text={text} />
}
