import { useState, type CSSProperties } from 'react'
import type { TelescopeEntry, EntryDetailContent } from '@shared/telescope'
import { useTelescopeEntry, useTelescopeRelated } from '../lib/hooks'
import { detailTabs, typeConfig } from '../lib/telescope-types'
import { entryTitle, entryIcon, entryBadge, entrySecondary, entryPrimary } from '../lib/telescope-present'
import { formatAbsoluteTime, formatDuration } from '../lib/telescope-format'
import { Badge, KeyVals, JsonBlock, Code, MaybeJson, EmptyHint } from './telescope-ui'

interface Props {
  connectionId: string
  entry: TelescopeEntry
  onSelectEntry: (e: TelescopeEntry) => void
  onClose: () => void
}

/** The detail pane: a header (title / metadata / uuid) over a per-type tab strip, plus a 'Related'
 *  tab (batch correlation). Content is lazy-loaded by uuid. */
export default function TelescopeDetail({ connectionId, entry, onSelectEntry, onClose }: Props): JSX.Element {
  const hasBatch = !!entry.batchId
  const baseTabs = detailTabs(entry.type)
  const tabs = hasBatch ? [...baseTabs, 'Related'] : baseTabs
  const [tab, setTab] = useState(tabs[0])
  const activeTab = tabs.includes(tab) ? tab : tabs[0]

  const { data: detail, isLoading, isError } = useTelescopeEntry(connectionId, entry.uuid)
  const badge = entryBadge(entry)

  return (
    <div className="tele-detail">
      <div className="tele-detail-head">
        <div className="tele-detail-titlerow">
          <span className="tele-detail-icon" aria-hidden="true">{entryIcon(entry)}</span>
          <span className="tele-detail-title" title={entryPrimary(entry)}>{entryTitle(entry)}</span>
          {badge && <Badge tone={badge.tone}>{badge.text}</Badge>}
          <span className="spacer" />
          <button className="tele-detail-close" aria-label="Close detail" onClick={onClose}>×</button>
        </div>
        <div className="tele-detail-meta">
          {entrySecondary(entry).join(' · ')}
          {entry.createdAt && <span title="Recorded at" className="tele-detail-abs">· {formatAbsoluteTime(entry.createdAt)}</span>}
        </div>
        <div className="tele-detail-uuid" title="Entry UUID">{entry.uuid}</div>
      </div>

      <div className="tele-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={t === activeTab}
            className={`tele-tab${t === activeTab ? ' active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="tele-detail-body">
        {activeTab === 'Related' ? (
          <RelatedEntries connectionId={connectionId} entry={entry} onSelectEntry={onSelectEntry} />
        ) : isLoading ? (
          <EmptyHint>Loading…</EmptyHint>
        ) : isError || !detail ? (
          <EmptyHint>Could not load entry content.</EmptyHint>
        ) : (
          <DetailBody content={detail.content} tab={activeTab} />
        )}
      </div>
    </div>
  )
}

/** Renders the active tab for a typed content shape. */
function DetailBody({ content, tab }: { content: EntryDetailContent; tab: string }): JSX.Element {
  switch (content.type) {
    case 'request':
      if (tab === 'Headers') return <KeyVals rows={Object.entries(content.headers ?? {})} />
      if (tab === 'Payload') return content.payload ? <JsonBlock value={content.payload} /> : <EmptyHint>No payload</EmptyHint>
      return content.response ? <MaybeJson text={content.response} /> : <EmptyHint>No response body</EmptyHint>
    case 'query':
      if (tab === 'Bindings')
        return content.bindings && content.bindings.length
          ? <KeyVals rows={content.bindings.map((b, i) => [`?${i + 1}`, JSON.stringify(b)])} />
          : <EmptyHint>No bindings</EmptyHint>
      return (
        <div className="tele-stack">
          {content.slow && <Badge tone="warn">Slow query</Badge>}
          <Code text={content.sql ?? ''} />
          <KeyVals rows={[['Connection', content.connection], ['Time', content.time != null ? `${content.time} ms` : null], ['Source', content.file ? `${content.file}:${content.line ?? ''}` : null]]} />
        </div>
      )
    case 'exception':
      if (tab === 'Context') return <JsonBlock value={content.context} />
      return <ExceptionStack content={content} />
    case 'log':
      if (tab === 'Context') return <JsonBlock value={content.context} />
      return content.message ? <Code text={content.message} /> : <EmptyHint>No message</EmptyHint>
    case 'job':
      if (tab === 'Payload') return <JsonBlock value={content.data} />
      return <KeyVals rows={[['Name', content.name], ['Status', content.status], ['Queue', content.queue], ['Connection', content.connection], ['Tries', content.tries], ['Timeout', content.timeout]]} />
    case 'mail':
      if (tab === 'Preview') return content.html ? <Code text={content.html} /> : <EmptyHint>No preview</EmptyHint>
      return <KeyVals rows={[['Subject', content.subject], ['Mailable', content.mailable], ['From', addrList(content.from)], ['To', addrList(content.to)], ['Cc', addrList(content.cc)], ['Bcc', addrList(content.bcc)], ['Queued', content.queued]]} />
    case 'cache':
      if (tab === 'Value') return <JsonBlock value={content.value} />
      return <KeyVals rows={[['Operation', content.cacheType], ['Key', content.key], ['Expiration', content.expiration]]} />
    case 'model':
      if (tab === 'Changes') return <JsonBlock value={content.changes} />
      return <KeyVals rows={[['Action', content.action], ['Model', content.model], ['Count', content.count]]} />
    case 'event':
      if (tab === 'Listeners') return <JsonBlock value={content.listeners} />
      return <KeyVals rows={[['Event', content.name], ['Broadcast', content.broadcast]]} />
    case 'command':
      if (tab === 'Arguments') return <JsonBlock value={{ arguments: content.arguments, options: content.options }} />
      return <KeyVals rows={[['Command', content.command], ['Exit code', content.exitCode]]} />
    case 'schedule':
      if (tab === 'Output') return content.output ? <Code text={content.output} /> : <EmptyHint>No output</EmptyHint>
      return <KeyVals rows={[['Command', content.command], ['Expression', content.expression], ['Description', content.description], ['Timezone', content.timezone], ['User', content.user]]} />
    case 'notification':
      return (
        <div className="tele-stack">
          <KeyVals rows={[['Notification', content.notification], ['Channel', content.channel], ['Notifiable', content.notifiable], ['Queued', content.queued]]} />
          {content.response != null && <JsonBlock value={content.response} />}
        </div>
      )
    case 'gate':
      return (
        <div className="tele-stack">
          <KeyVals rows={[['Ability', content.ability], ['Result', content.result], ['Source', content.file ? `${content.file}:${content.line ?? ''}` : null]]} />
          {content.arguments && content.arguments.length > 0 && <JsonBlock value={content.arguments} />}
        </div>
      )
    case 'view':
      return (
        <div className="tele-stack">
          <KeyVals rows={[['View', content.name], ['Path', content.path]]} />
          {content.data && <JsonBlock value={content.data} />}
        </div>
      )
    case 'redis':
      return <KeyVals rows={[['Connection', content.connection], ['Command', content.command], ['Time', content.time != null ? `${content.time} ms` : null]]} />
    case 'batch':
      return <KeyVals rows={[['Name', content.name], ['Total jobs', content.totalJobs], ['Pending', content.pendingJobs], ['Processed', content.processedJobs], ['Failed', content.failedJobs], ['Progress', content.progress != null ? `${content.progress}%` : null], ['Queue', content.queue]]} />
    case 'dump':
      return content.dump ? <Code text={content.dump} /> : <EmptyHint>Empty dump</EmptyHint>
    default:
      return <JsonBlock value={content.data} />
  }
}

function addrList(list: { name?: string; address?: string }[] | null | undefined): string {
  if (!list || list.length === 0) return ''
  return list.map((a) => a.address ?? a.name ?? '').filter(Boolean).join(', ')
}

/** Exception stack trace: message + frames, with vendor frames dimmed + collapsible. */
function ExceptionStack({ content }: { content: Extract<EntryDetailContent, { type: 'exception' }> }): JSX.Element {
  const [showVendor, setShowVendor] = useState(false)
  const frames = content.trace ?? []
  const vendorCount = frames.filter((f) => (f.file ?? '').includes('/vendor/')).length
  return (
    <div className="tele-stack">
      {content.message && <div className="tele-exc-message">{content.message}</div>}
      {(content.file || content.line != null) && (
        <div className="tele-exc-origin">{content.file}{content.line != null ? `:${content.line}` : ''}</div>
      )}
      {vendorCount > 0 && (
        <button className="btn xs ghost" onClick={() => setShowVendor((v) => !v)}>
          {showVendor ? 'Hide' : 'Show'} {vendorCount} vendor frame{vendorCount === 1 ? '' : 's'}
        </button>
      )}
      <div className="tele-frames">
        {frames.map((f, i) => {
          const vendor = (f.file ?? '').includes('/vendor/')
          if (vendor && !showVendor) return null
          return (
            <div key={i} className={`tele-frame${vendor ? ' vendor' : ''}`}>
              <span className="tele-frame-loc">{f.file}{f.line != null ? `:${f.line}` : ''}</span>
              {f.function && <span className="tele-frame-fn">{f.function}</span>}
            </div>
          )
        })}
        {frames.length === 0 && <EmptyHint>No stack trace</EmptyHint>}
      </div>
    </div>
  )
}

/** Sibling entries in the same batch — click to inspect. */
function RelatedEntries({ connectionId, entry, onSelectEntry }: { connectionId: string; entry: TelescopeEntry; onSelectEntry: (e: TelescopeEntry) => void }): JSX.Element {
  const { data: related = [], isLoading } = useTelescopeRelated(connectionId, entry.batchId, entry.uuid)
  if (isLoading) return <EmptyHint>Loading related…</EmptyHint>
  if (related.length === 0) return <EmptyHint>No related entries in this batch.</EmptyHint>
  return (
    <div className="tele-related">
      {related.map((r) => {
        const badge = entryBadge(r)
        const color = typeConfig(r.type).color
        // Show how long timed operations took — query execution time, and redis command time.
        const time =
          r.summary.type === 'query' ? formatDuration(r.summary.duration)
            : r.summary.type === 'redis' ? `${r.summary.duration}ms`
              : null
        return (
          <button
            key={r.uuid}
            className="tele-related-row"
            style={{ ['--tele-row-color']: color } as CSSProperties}
            onClick={() => onSelectEntry(r)}
          >
            <span className="tele-related-dot" style={{ background: color }} title={r.type} aria-hidden="true" />
            <span className="tele-related-text">{entryPrimary(r)}</span>
            {time && <span className="tele-related-time">{time}</span>}
            {badge && <Badge tone={badge.tone}>{badge.text}</Badge>}
          </button>
        )
      })}
    </div>
  )
}
