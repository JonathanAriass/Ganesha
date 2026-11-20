import { describe, it, expect } from 'vitest'
import { parseAwsProfiles, parseArn, parseInstances, parseInstanceNames, nameInstances } from './aws'

describe('parseAwsProfiles', () => {
  const config = `
[default]
region = eu-west-3

[profile jonathan.arias@okticket.es]
sso_start_url = https://x.awsapps.com/start
region = eu-west-3

[sso-session okticket]
sso_region = eu-west-3
`
  const creds = `
[ci-bot]
aws_access_key_id = AKIA...
`
  it('reads profile + default from config and plain sections from credentials, skipping sso-session', () => {
    expect(parseAwsProfiles(config, creds)).toEqual(['ci-bot', 'default', 'jonathan.arias@okticket.es'])
  })
  it('is safe when a file is absent', () => {
    expect(parseAwsProfiles(null, null)).toEqual([])
    expect(parseAwsProfiles('[profile a]', null)).toEqual(['a'])
  })
})

describe('parseArn', () => {
  it('pulls the caller arn from get-caller-identity json', () => {
    expect(parseArn('{"UserId":"X","Account":"1","Arn":"arn:aws:sts::1:assumed-role/r/me"}')).toBe('arn:aws:sts::1:assumed-role/r/me')
  })
})

describe('parseInstances', () => {
  it('maps SSM instances to {instanceId, name, ping}, name falling back to the id', () => {
    const json = JSON.stringify({
      InstanceInformationList: [
        { InstanceId: 'i-00c1e3074e28c493a', ComputerName: 'swa-sql-master', PingStatus: 'Online' },
        { InstanceId: 'i-0899f911a6939be61', PingStatus: 'ConnectionLost' }
      ]
    })
    expect(parseInstances(json)).toEqual([
      { instanceId: 'i-00c1e3074e28c493a', name: 'swa-sql-master', ping: 'Online' },
      { instanceId: 'i-0899f911a6939be61', name: 'i-0899f911a6939be61', ping: 'ConnectionLost' }
    ])
  })
  it('handles an empty list', () => {
    expect(parseInstances('{}')).toEqual([])
  })
})

describe('instance names', () => {
  const ssm = [
    { instanceId: 'i-0b', name: 'ip-10-0-1-23.eu-west-3.compute.internal', ping: 'Online' },
    { instanceId: 'i-0a', name: 'swa-sql-master', ping: 'Online' },
    { instanceId: 'i-0c', name: 'i-0c', ping: 'Online' }
  ]
  it('reads Name tags, skipping untagged and blank ones', () => {
    const json = JSON.stringify([{ id: 'i-0b', name: 'orders-api-2' }, { id: 'i-0a', name: null }, { id: 'i-0c', name: '  ' }])
    expect(parseInstanceNames(json)).toEqual({ 'i-0b': 'orders-api-2' })
    expect(parseInstanceNames('null')).toEqual({})
  })
  it('puts the tag first, keeps the host name, and sorts by name', () => {
    expect(nameInstances(ssm, { 'i-0b': 'orders-api-2', 'i-0c': 'bastion' })).toEqual([
      { instanceId: 'i-0c', name: 'bastion', ping: 'Online' },
      { instanceId: 'i-0b', name: 'orders-api-2', ping: 'Online', host: 'ip-10-0-1-23.eu-west-3.compute.internal' },
      { instanceId: 'i-0a', name: 'swa-sql-master', ping: 'Online' }
    ])
  })
  it('leaves the list as SSM reported it when no tags could be read', () => {
    expect(nameInstances(ssm, {}).map((i) => i.name)).toEqual(['i-0c', 'ip-10-0-1-23.eu-west-3.compute.internal', 'swa-sql-master'])
  })
})
