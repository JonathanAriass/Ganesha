/** Query tabs grouped by the connection (server) they belong to. Groups are a derived view over
 *  the flat tabs array — there is no parallel data structure. Pure helpers; the store wraps them. */

export interface TabGroup<T> {
  connectionId: string
  tabs: T[]
}

/** Group tabs by connection, ordered by each connection's first appearance; tab order preserved. */
export function groupTabs<T extends { connectionId: string }>(tabs: T[]): TabGroup<T>[] {
  const order: string[] = []
  const byConn = new Map<string, T[]>()
  for (const t of tabs) {
    let bucket = byConn.get(t.connectionId)
    if (!bucket) {
      bucket = []
      byConn.set(t.connectionId, bucket)
      order.push(t.connectionId)
    }
    bucket.push(t)
  }
  return order.map((connectionId) => ({ connectionId, tabs: byConn.get(connectionId)! }))
}
