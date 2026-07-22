// Live-tail poller for the Telescope inspector. One reschedulable timer per subscribed connection
// tracks the highest seen `sequence` and emits only genuinely-new entries. Uses setTimeout (not
// setInterval) so a slow query never overlaps the next poll. Decoupled from the driver plumbing via
// the injected `fetchSince` so it's unit-testable.

import type { TelescopeEntry, TelescopeNewEntriesEvent } from '../../shared/telescope'

/** Compare two BIGINT sequences held as strings. */
function seqGt(a: string, b: string): boolean {
  try { return BigInt(a) > BigInt(b) } catch { return a > b }
}

export interface TailDeps {
  /** Entries with sequence > lastSequence, DESC (newest first). Called with '0' to seed the max. */
  fetchSince: (connectionId: string, lastSequence: string) => Promise<TelescopeEntry[]>
  emit: (event: TelescopeNewEntriesEvent) => void
  intervalMs?: number
}

interface Sub {
  lastSequence: string
  timer: ReturnType<typeof setTimeout> | null
}

export class TelescopeTailManager {
  private subs = new Map<string, Sub>()
  private paused = false

  constructor(private deps: TailDeps) {}

  private get interval(): number {
    return this.deps.intervalMs ?? 3000
  }

  /** Begin tailing a connection (idempotent). Seeds the cursor to the current max so history isn't
   *  re-emitted, then schedules polling. */
  async start(connectionId: string): Promise<void> {
    if (this.subs.has(connectionId)) return
    const sub: Sub = { lastSequence: '0', timer: null }
    this.subs.set(connectionId, sub)
    try {
      const rows = await this.deps.fetchSince(connectionId, '0')
      if (rows.length) sub.lastSequence = rows[0].sequence // DESC → [0] is the max
    } catch {
      // Seed failed (tunnel not up yet, etc.); the first poll will seed from lastSequence '0'.
    }
    if (!this.subs.has(connectionId)) return // stopped during the seed await
    this.schedule(connectionId)
  }

  private schedule(connectionId: string): void {
    const sub = this.subs.get(connectionId)
    if (!sub || this.paused) return
    sub.timer = setTimeout(() => void this.poll(connectionId), this.interval)
  }

  private async poll(connectionId: string): Promise<void> {
    const sub = this.subs.get(connectionId)
    if (!sub) return
    try {
      const rows = await this.deps.fetchSince(connectionId, sub.lastSequence)
      if (rows.length) {
        if (seqGt(rows[0].sequence, sub.lastSequence)) sub.lastSequence = rows[0].sequence
        this.deps.emit({ connectionId, entries: rows })
      }
    } catch {
      // Transient (tunnel drop, timeout) — keep the subscription alive and try again next tick.
    } finally {
      if (this.subs.has(connectionId)) this.schedule(connectionId)
    }
  }

  /** Stop tailing one connection. */
  stop(connectionId: string): void {
    const sub = this.subs.get(connectionId)
    if (sub?.timer) clearTimeout(sub.timer)
    this.subs.delete(connectionId)
  }

  /** Stop every subscription (app quit). */
  stopAll(): void {
    for (const id of [...this.subs.keys()]) this.stop(id)
  }

  /** Pause polling for all subscriptions (e.g. window blurred) without losing cursors. */
  pauseAll(): void {
    if (this.paused) return
    this.paused = true
    for (const sub of this.subs.values()) {
      if (sub.timer) { clearTimeout(sub.timer); sub.timer = null }
    }
  }

  /** Resume polling after a pause. */
  resumeAll(): void {
    if (!this.paused) return
    this.paused = false
    for (const id of this.subs.keys()) this.schedule(id)
  }
}
