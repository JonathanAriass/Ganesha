import type { DatabaseDriver } from './types'
import type { ConnectionType } from '../../shared/domain'

/** Holds one driver instance per connection type and routes by type. */
export class DriverManager {
  private drivers = new Map<ConnectionType, DatabaseDriver>()

  register(driver: DatabaseDriver): void {
    this.drivers.set(driver.type, driver)
  }

  has(type: ConnectionType): boolean {
    return this.drivers.has(type)
  }

  get(type: ConnectionType): DatabaseDriver {
    const driver = this.drivers.get(type)
    if (!driver) throw new Error(`No driver registered for connection type '${type}'`)
    return driver
  }

  /** Drop any pool/connection a connection id holds across every registered driver.
   *  disconnect is a no-op when a driver has no pool for the id, so this needs no
   *  type lookup — used to evict a stale pool when its SSH tunnel drops. */
  async disconnectAll(connId: string): Promise<void> {
    await Promise.all([...this.drivers.values()].map((d) => d.disconnect(connId).catch(() => {})))
  }
}
