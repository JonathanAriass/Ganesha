/** The Laravel Telescope inspector — a read-only, master-detail browser over the telescope_entries
 *  table of `connectionId`. Full UI is built in Phase 5; this is the tab-content shell. */
export default function TelescopeView({ connectionId }: { connectionId: string }): JSX.Element {
  return (
    <div className="telescope" data-connection-id={connectionId}>
      <div className="telescope-empty" role="status">
        Telescope inspector
      </div>
    </div>
  )
}
