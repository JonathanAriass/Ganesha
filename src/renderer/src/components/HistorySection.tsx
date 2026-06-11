import { useAppStore } from '../state/store'
import { useHistory } from '../lib/hooks'

export default function HistorySection(): JSX.Element | null {
  const activeConnectionId = useAppStore((s) => s.activeConnectionId)
  const openOrLoadQuery = useAppStore((s) => s.openOrLoadQuery)

  const { data: entries, isLoading } = useHistory(activeConnectionId)

  if (!activeConnectionId) return null

  return (
    <details className="history">
      <summary>History</summary>
      {!isLoading && entries && entries.length === 0 && (
        <div className="h-empty">No queries yet</div>
      )}
      {entries &&
        entries.map((entry) => {
          const isFail = entry.success === false
          const hh = new Date(entry.ranAt).getHours().toString().padStart(2, '0')
          const mm = new Date(entry.ranAt).getMinutes().toString().padStart(2, '0')
          const timeStr = `${hh}:${mm}`
          const snippet = entry.query.slice(0, 60)

          return (
            <button
              key={entry.id}
              className="history-item"
              onClick={() =>
                openOrLoadQuery({
                  connectionId: activeConnectionId,
                  title: 'History',
                  text: entry.query
                })
              }
            >
              <span className={`h-dot${isFail ? ' fail' : ' ok'}`} />
              <span className="h-text" title={entry.query}>
                {snippet}
              </span>
              <span className="h-time">{timeStr}</span>
            </button>
          )
        })}
    </details>
  )
}
