import { Command } from 'cmdk'
import { useAppStore } from '../state/store'
import { useConnections, useObjects, useSavedQueries, useSettings, useSetSetting } from '../lib/hooks'
import { defaultTableQuery } from '../lib/tabquery'
import { mod } from '../lib/platform'
import { useRestoreFocus } from '../lib/use-restore-focus'

/** Rendered only while open (parent gates on store.paletteOpen). */
export default function CommandPalette(): JSX.Element {
  const setPaletteOpen = useAppStore((s) => s.setPaletteOpen)
  const openSettings = useAppStore((s) => s.openSettings)
  const openQueryTab = useAppStore((s) => s.openQueryTab)
  const activeConnectionId = useAppStore((s) => s.activeConnectionId)
  const setActiveConnection = useAppStore((s) => s.setActiveConnection)

  const { data: connections = [] } = useConnections()
  const { data: objects = [] } = useObjects(activeConnectionId)
  const { data: snippets = [] } = useSavedQueries(activeConnectionId)
  const { data: settings } = useSettings()
  const setSetting = useSetSetting()

  const activeConn = connections.find((c) => c.id === activeConnectionId)

  useRestoreFocus()

  function close(): void {
    setPaletteOpen(false)
  }

  return (
    <div className="palette-overlay" onClick={close}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <Command label="Command palette">
          <Command.Input autoFocus placeholder="Type a command or search…" />
          <Command.List>
            <Command.Empty>No results.</Command.Empty>

            <Command.Group heading="Actions">
              {activeConnectionId && (
                <Command.Item
                  value="action new query tab"
                  onSelect={() => {
                    openQueryTab({ connectionId: activeConnectionId })
                    close()
                  }}
                >
                  New query tab
                  <span className="kbd">{mod}T</span>
                </Command.Item>
              )}
              <Command.Item
                value="action toggle theme"
                onSelect={() => {
                  if (!settings) return // theme unknown while loading — don't guess
                  setSetting.mutate({
                    key: 'theme',
                    value: settings.theme === 'light' ? 'midnight' : 'light',
                  })
                  close()
                }}
              >
                Toggle theme
              </Command.Item>
              <Command.Item value="action open settings" onSelect={openSettings}>
                Open settings
                <span className="kbd">{mod},</span>
              </Command.Item>
            </Command.Group>

            {activeConn && snippets.length > 0 && (
              <Command.Group heading={`Saved — ${activeConn.name}`}>
                {snippets.map((q) => (
                  <Command.Item
                    key={q.id}
                    // id keeps the value unique when two snippets share a name
                    value={`saved ${q.name} ${q.id}`}
                    onSelect={() => {
                      // Match the sidebar: activating a saved query opens a fresh tab and runs it.
                      openQueryTab({
                        connectionId: activeConn.id,
                        title: q.name,
                        text: q.query,
                        runOnOpen: true,
                      })
                      close()
                    }}
                  >
                    <span className="obj-icon saved" aria-hidden="true">
                      ★
                    </span>
                    {q.name}
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {connections.length > 0 && (
              <Command.Group heading="Connections">
                {connections.map((c) => (
                  <Command.Item
                    key={c.id}
                    // id keeps the value unique when two connections share a
                    // name — duplicate cmdk values break selection.
                    value={`connection ${c.name} ${c.type} ${c.id}`}
                    onSelect={() => {
                      setActiveConnection(c.id)
                      close()
                    }}
                  >
                    <span
                      className="conn-dot"
                      style={{ background: c.color, width: 8, height: 8 }}
                      aria-hidden="true"
                    />
                    {c.name}
                    <span className="palette-meta">{c.type}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {activeConn && objects.length > 0 && (
              <Command.Group heading={`Objects — ${activeConn.name}`}>
                {objects.map((o) => (
                  <Command.Item
                    key={`${o.schema ?? ''}:${o.name}`}
                    value={`object ${o.kind} ${o.schema ?? ''} ${o.name}`}
                    onSelect={() => {
                      openQueryTab({
                        connectionId: activeConn.id,
                        title: o.name,
                        text: defaultTableQuery(activeConn.type, {
                          schema: o.schema,
                          name: o.name,
                        }),
                        runOnOpen: true,
                      })
                      close()
                    }}
                  >
                    <span className={`obj-icon ${o.kind}`} aria-hidden="true">
                      {o.kind === 'table' ? 'T' : o.kind === 'view' ? 'V' : 'C'}
                    </span>
                    {o.name}
                    {o.schema && <span className="palette-meta">{o.schema}</span>}
                  </Command.Item>
                ))}
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </div>
    </div>
  )
}
