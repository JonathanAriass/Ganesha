import type { PingResult } from './ipc'

/** The full surface the preload exposes to the renderer. Grows in later plans. */
export interface DbClientApi {
  ping(message: string): Promise<PingResult>
}
