import { describe, it, expect } from 'vitest'
import { filterInstances } from './instance-filter'

const list = [
  { instanceId: 'i-0b', name: 'orders-api-2', ping: 'Online', host: 'ip-10-0-1-23.eu-west-3.compute.internal' },
  { instanceId: 'i-0a', name: 'swa-sql-master', ping: 'Online' },
  { instanceId: 'i-0c', name: 'i-0c', ping: 'Online' }
]

describe('filterInstances', () => {
  it('matches name, host name or id, requiring every word', () => {
    expect(filterInstances(list, 'ORDERS api').map((i) => i.instanceId)).toEqual(['i-0b'])
    expect(filterInstances(list, '10-0-1-23').map((i) => i.instanceId)).toEqual(['i-0b'])
    expect(filterInstances(list, 'sql').map((i) => i.instanceId)).toEqual(['i-0a'])
    expect(filterInstances(list, 'orders sql')).toEqual([])
  })
  it('returns everything for an empty query', () => {
    expect(filterInstances(list, '  ')).toHaveLength(3)
  })
  it('returns everything when the value is exactly a chosen instance id', () => {
    expect(filterInstances(list, 'i-0a')).toHaveLength(3)
    expect(filterInstances(list, 'i-0')).toHaveLength(3) // every id contains it
    expect(filterInstances(list, 'i-0z')).toEqual([])
  })
})
