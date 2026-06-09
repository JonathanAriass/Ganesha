import { describe, it, expectTypeOf } from 'vitest'
import type { IpcChannels, ChannelName } from './ipc'
import type { Result } from './result'

describe('IPC contract', () => {
  it('ping channel maps string request to PingPayload response', () => {
    expectTypeOf<IpcChannels['ping']['req']>().toEqualTypeOf<string>()
    expectTypeOf<IpcChannels['ping']['res']>().toMatchTypeOf<{ pong: string }>()
  })
  it('ChannelName is the union of channel keys', () => {
    expectTypeOf<'ping'>().toMatchTypeOf<ChannelName>()
  })
  it('every channel response is wrappable in Result', () => {
    type R = Result<IpcChannels['ping']['res']>
    expectTypeOf<R>().toMatchTypeOf<{ ok: boolean }>()
  })
})
