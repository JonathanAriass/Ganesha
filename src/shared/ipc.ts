import type { Result } from './result'

export interface PingPayload {
  pong: string
}

/**
 * The single source of truth for IPC channels. Each key is a channel name;
 * `req` is the renderer→main argument type, `res` is the success payload
 * (always delivered wrapped in Result<res> by the typed invoke/handle helpers).
 * New channels are added here in later tasks.
 */
export interface IpcChannels {
  ping: { req: string; res: PingPayload }
}

export type ChannelName = keyof IpcChannels
export type Req<K extends ChannelName> = IpcChannels[K]['req']
export type Res<K extends ChannelName> = IpcChannels[K]['res']
export type IpcResult<K extends ChannelName> = Result<Res<K>>
