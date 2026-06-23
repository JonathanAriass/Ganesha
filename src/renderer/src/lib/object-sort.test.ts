import { describe, it, expect } from 'vitest'
import type { DbObject } from '@shared/schema'
import { sortObjects, loadSortMode, saveSortMode } from './object-sort'

const t = (name: string, schema: string | null = null): DbObject => ({ schema, name, kind: 'table' })
const names = (objs: DbObject[]): string[] => objs.map((o) => o.name)

describe('sortObjects', () => {
  const sample = [
    t('100_okt_card_mids'),
    t('02_users'),
    t('10_licenses'),
    t('01_companies'),
    t('11_features'),
    t('09_role_report_status'),
    t('104_banking_accounts'),
  ]

  it('number mode orders by the numeric prefix (1 < 2 < 9 < 10 < 11 < 100 < 104)', () => {
    expect(names(sortObjects(sample, 'number'))).toEqual([
      '01_companies',
      '02_users',
      '09_role_report_status',
      '10_licenses',
      '11_features',
      '100_okt_card_mids',
      '104_banking_accounts',
    ])
  })

  it('full mode is plain text order (100_ sorts before 10_)', () => {
    expect(names(sortObjects([t('10_licenses'), t('100_okt_card_mids'), t('11_features')], 'full'))).toEqual([
      '100_okt_card_mids',
      '10_licenses',
      '11_features',
    ])
  })

  it('name mode ignores the NN_ prefix and sorts by the table name', () => {
    expect(names(sortObjects(sample, 'name'))).toEqual([
      '104_banking_accounts', // banking_accounts
      '01_companies', // companies
      '11_features', // features
      '10_licenses', // licenses
      '100_okt_card_mids', // okt_card_mids
      '09_role_report_status', // role_report_status
      '02_users', // users
    ])
  })

  it('handles unprefixed names in every mode (plain alphabetical)', () => {
    const objs = [t('users'), t('orders'), t('audit_logs')]
    expect(names(sortObjects(objs, 'name'))).toEqual(['audit_logs', 'orders', 'users'])
    expect(names(sortObjects(objs, 'number'))).toEqual(['audit_logs', 'orders', 'users'])
    expect(names(sortObjects(objs, 'full'))).toEqual(['audit_logs', 'orders', 'users'])
  })

  it('groups by schema first, then sorts within (postgres schemas / mongo databases)', () => {
    const objs = [t('z', 'public'), t('a', 'public'), t('m', 'admin')]
    expect(sortObjects(objs, 'name').map((o) => `${o.schema}.${o.name}`)).toEqual([
      'admin.m',
      'public.a',
      'public.z',
    ])
  })

  it('does not mutate the input array', () => {
    const objs = [t('b'), t('a')]
    const copy = [...objs]
    sortObjects(objs, 'name')
    expect(objs).toEqual(copy)
  })
})

describe('sort-mode persistence', () => {
  function fakeStorage(): Storage {
    let v: string | null = null
    return {
      getItem: () => v,
      setItem: (_k: string, val: string) => {
        v = val
      },
    } as unknown as Storage
  }

  it('defaults to number when unset', () => {
    expect(loadSortMode(fakeStorage())).toBe('number')
  })
  it('round-trips a saved mode', () => {
    const s = fakeStorage()
    saveSortMode('name', s)
    expect(loadSortMode(s)).toBe('name')
  })
  it('heals an invalid stored value to the default', () => {
    const s = fakeStorage()
    s.setItem('object-sort', 'bogus')
    expect(loadSortMode(s)).toBe('number')
  })
})
