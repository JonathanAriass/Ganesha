import type { Result } from './result'

/** Canonical IPC channel names. Add new channels here in later plans. */
export const IPC = {
  ping: 'app:ping'
} as const

export interface PingPayload {
  pong: string
}

export type PingResult = Result<PingPayload>
