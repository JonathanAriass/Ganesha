import { describe, it, expect } from 'vitest'
import { buildSsmArgs } from './command'

describe('buildSsmArgs', () => {
  const t = { profile: 'jonathan@okticket', region: 'eu-west-3', instanceId: 'i-00c1e3074e28c493a', remotePort: 3306, localPort: 13306 }

  it('builds the port-forwarding argv with the target, profile and region', () => {
    const a = buildSsmArgs(t)
    expect(a.slice(0, 2)).toEqual(['ssm', 'start-session'])
    expect(a).toContain('--target')
    expect(a[a.indexOf('--target') + 1]).toBe('i-00c1e3074e28c493a')
    expect(a[a.indexOf('--profile') + 1]).toBe('jonathan@okticket')
    expect(a[a.indexOf('--region') + 1]).toBe('eu-west-3')
    expect(a[a.indexOf('--document-name') + 1]).toBe('AWS-StartPortForwardingSession')
  })

  it('passes ports as a single JSON --parameters element (strings, as AWS requires)', () => {
    const a = buildSsmArgs(t)
    const params = JSON.parse(a[a.indexOf('--parameters') + 1])
    expect(params).toEqual({ portNumber: ['3306'], localPortNumber: ['13306'] })
  })
})
