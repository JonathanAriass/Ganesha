import { useEffect, useMemo, useState } from 'react'
import type { TelescopeEntry, TelescopeType } from '@shared/telescope'
import { useTelescopeEntries, useTelescopeTags } from '../lib/hooks'
import { TYPE_CONFIGS, typeConfig } from '../lib/telescope-types'
import TelescopeEntryList from './TelescopeEntryList'
import TelescopeDetail from './TelescopeDetail'

/** The Laravel Telescope inspector: a read-only master-detail browser over telescope_entries.
 *  Left: entry-type sidebar. Middle: virtualized entry list (with search + tag filter). Right: the
 *  selected entry's detail. `connectionId`'s pool + SSH tunnel are reused; all reads are read-only. */
export default function TelescopeView({ connectionId }: { connectionId: string }): JSX.Element {
  const [selectedType, setSelectedType] = useState<TelescopeType>('request')
  const [selected, setSelected] = useState<TelescopeEntry | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [tag, setTag] = useState('')

  // Debounce the search box (300ms) — server-side content search is relatively expensive.
  useEffect(() => {
    const h = setTimeout(() => setSearch(searchInput), 300)
    return () => clearTimeout(h)
  }, [searchInput])

  const searchActive = search.trim().length > 0
  // A text search spans ALL types (the sidebar visually deselects); a tag filter keeps the type.
  const filter = useMemo(
    () => ({ type: searchActive ? null : selectedType, tag: tag || null, search: search || null }),
    [searchActive, selectedType, tag, search]
  )

  const { data, isLoading, isError, error, hasNextPage, isFetchingNextPage, fetchNextPage } = useTelescopeEntries(connectionId, filter)
  const { data: tags = [] } = useTelescopeTags(connectionId)
  const entries = useMemo(() => data?.pages.flatMap((p) => p.entries) ?? [], [data])

  // Reset the open entry when the filter changes (the selected one may no longer be listed).
  useEffect(() => { setSelected(null) }, [selectedType, tag, search])

  const emptyLabel = searchActive
    ? `No entries matching “${search}”.`
    : tag
      ? `No ${typeConfig(selectedType).label.toLowerCase()} tagged “${tag}”.`
      : `No ${typeConfig(selectedType).label.toLowerCase()} recorded yet.`

  return (
    <div className="telescope">
      <aside className="tele-sidebar">
        {TYPE_CONFIGS.map((c) => (
          <button
            key={c.type}
            className={`tele-type${!searchActive && c.type === selectedType ? ' active' : ''}`}
            onClick={() => { setSelectedType(c.type); setSearchInput(''); setSearch('') }}
          >
            <span className="tele-type-icon" aria-hidden="true">{c.icon}</span>
            <span className="tele-type-label">{c.label}</span>
          </button>
        ))}
      </aside>

      <div className="tele-main">
        <div className="tele-filterbar">
          <input
            className="tele-search"
            placeholder="Search all entries…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="Search Telescope entries"
          />
          {searchInput && (
            <button className="tele-search-clear" aria-label="Clear search" onClick={() => { setSearchInput(''); setSearch('') }}>×</button>
          )}
          {tags.length > 0 && (
            <select className="tele-tag-select" value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Filter by tag">
              <option value="">All tags</option>
              {tags.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
        </div>

        <div className={`tele-content${selected ? ' with-detail' : ''}`}>
          <div className="tele-listpane">
            <TelescopeEntryList
              entries={entries}
              selectedUuid={selected?.uuid ?? null}
              onSelect={setSelected}
              isLoading={isLoading}
              isError={isError}
              error={error instanceof Error ? error.message : undefined}
              hasNextPage={!!hasNextPage}
              isFetchingNextPage={isFetchingNextPage}
              fetchNextPage={fetchNextPage}
              emptyLabel={emptyLabel}
            />
          </div>
          {selected && (
            <div className="tele-detailpane">
              <TelescopeDetail connectionId={connectionId} entry={selected} onSelectEntry={setSelected} onClose={() => setSelected(null)} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
