import { describe, it, expect } from 'vitest'
import { parseAwsProfiles, parseArn, parseInstances } from './aws'

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
