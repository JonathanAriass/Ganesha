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
}
