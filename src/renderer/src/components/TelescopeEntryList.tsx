import { useRef, useEffect, type CSSProperties } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { TelescopeEntry } from '@shared/telescope'
import { entryIcon, entryMethod, entryPrimary, entrySecondary, entryBadge } from '../lib/telescope-present'
import { Badge } from './telescope-ui'

const ROW_H = 64

interface Props {
  entries: TelescopeEntry[]
  selectedUuid: string | null
  onSelect: (e: TelescopeEntry) => void
  isLoading: boolean
  isError: boolean
  error?: string
  hasNextPage: boolean
  isFetchingNextPage: boolean
  fetchNextPage: () => void
  emptyLabel: string
}

/** Virtualized entry list (fixed 64px rows) with cursor-based infinite scroll. */
export default function TelescopeEntryList(props: Props): JSX.Element {
  const { entries, selectedUuid, onSelect, isLoading, isError, error, hasNextPage, isFetchingNextPage, fetchNextPage, emptyLabel } = props
  const parentRef = useRef<HTMLDivElement>(null)
  const count = entries.length + (hasNextPage ? 1 : 0)
  const virt = useVirtualizer({ count, getScrollElement: () => parentRef.current, estimateSize: () => ROW_H, overscan: 5 })
  const items = virt.getVirtualItems()

  useEffect(() => {
    const last = items[items.length - 1]
    if (last && last.index >= entries.length - 1 && hasNextPage && !isFetchingNextPage) fetchNextPage()
  }, [items, entries.length, hasNextPage, isFetchingNextPage, fetchNextPage])

  if (isLoading) return <div className="tele-list-state">Loading entries…</div>
  if (isError) return <div className="tele-list-state error" role="alert">{error ?? 'Failed to load entries.'}</div>
  if (entries.length === 0) return <div className="tele-list-state">{emptyLabel}</div>

  return (
    <div className="tele-list" ref={parentRef}>
      <div style={{ height: virt.getTotalSize(), position: 'relative', width: '100%' }}>
        {items.map((vi) => {
          const style: CSSProperties = { position: 'absolute', top: 0, left: 0, width: '100%', height: ROW_H, transform: `translateY(${vi.start}px)` }
          if (vi.index >= entries.length) {
            return <div key="loader" className="tele-row loader" style={style}>Loading…</div>
          }
          const e = entries[vi.index]
          return <Row key={e.uuid} entry={e} selected={e.uuid === selectedUuid} onSelect={onSelect} style={style} />
        })}
      </div>
    </div>
  )
}

function Row({ entry, selected, onSelect, style }: { entry: TelescopeEntry; selected: boolean; onSelect: (e: TelescopeEntry) => void; style: CSSProperties }): JSX.Element {
  const method = entryMethod(entry)
  const badge = entryBadge(entry)
  return (
    <button className={`tele-row${selected ? ' selected' : ''}`} style={style} onClick={() => onSelect(entry)}>
      <div className="tele-row-line1">
        <span className="tele-row-icon" aria-hidden="true">{entryIcon(entry)}</span>
        {method && <span className="tele-row-method">{method}</span>}
        <span className="tele-row-primary">{entryPrimary(entry)}</span>
        {badge && <Badge tone={badge.tone}>{badge.text}</Badge>}
      </div>
      <div className="tele-row-line2">{entrySecondary(entry).join(' · ')}</div>
    </button>
  )
}
