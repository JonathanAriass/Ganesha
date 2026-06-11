import { describe, it, expect } from 'vitest'
import { boundedFindLimit, boundedPipeline, buildMongoUri, isAuthError, withAuthSourceHint } from './mongo'
import type { MongoCommand } from './command'
import type { ConnectParams } from '../types'

const params: ConnectParams = {
  id: 'c1', type: 'mongodb', host: 'localhost', port: 27017,
  username: '', password: null, database: '', ssl: false
}

describe('buildMongoUri', () => {
  it('builds a bare uri and a db path', () => {
    expect(buildMongoUri(params)).toBe('mongodb://localhost:27017')
    expect(buildMongoUri({ ...params, database: 'app' })).toBe('mongodb://localhost:27017/app')
  })

  it('encodes credentials', () => {
    expect(buildMongoUri({ ...params, username: 'u@x', password: 'p:w' })).toBe(
      'mongodb://u%40x:p%3Aw@localhost:27017'
    )
  })

  it('adds authSource and replicaSet as options', () => {
    expect(buildMongoUri({ ...params, database: 'app', authSource: 'admin', replicaSet: 'rs0' })).toBe(
      'mongodb://localhost:27017/app?authSource=admin&replicaSet=rs0'
    )
  })

  it('keeps the delimiting slash when options exist without a db', () => {
    expect(buildMongoUri({ ...params, ssl: true })).toBe('mongodb://localhost:27017/?tls=true')
    expect(buildMongoUri({ ...params, authSource: 'admin' })).toBe(
      'mongodb://localhost:27017/?authSource=admin'
    )
  })

  it('treats empty-string options as absent', () => {
    expect(buildMongoUri({ ...params, authSource: '', replicaSet: '' })).toBe(
      'mongodb://localhost:27017'
    )
  })
})

describe('withAuthSourceHint', () => {
  const authFail = new Error('Authentication failed.')

  it('appends the Auth source remedy when a database is set without an authSource', () => {
    const e = withAuthSourceHint(authFail, { ...params, database: 'app' })
    expect(e.message).toMatch(/Authentication failed\./)
    expect(e.message).toMatch(/Auth source/)
    expect(e.message).toMatch(/'app'/)
  })

  it('leaves the error alone when authSource is set, no database is set, or it is not an auth failure', () => {
    expect(withAuthSourceHint(authFail, { ...params, database: 'app', authSource: 'admin' })).toBe(authFail)
    expect(withAuthSourceHint(authFail, params)).toBe(authFail)
    const other = new Error('connect ECONNREFUSED')
    expect(withAuthSourceHint(other, { ...params, database: 'app' })).toBe(other)
  })

  it('wraps non-Error throwables into an Error', () => {
    expect(withAuthSourceHint('boom', params)).toBeInstanceOf(Error)
  })
})

describe('isAuthError', () => {
  it('matches code 13 and authorization messages', () => {
    expect(isAuthError(Object.assign(new Error('x'), { code: 13 }))).toBe(true)
    expect(isAuthError(new Error('command listDatabases requires authentication'))).toBe(true)
    expect(isAuthError(new Error('not authorized on admin to execute command'))).toBe(true)
  })

  it('rejects non-auth failures', () => {
    expect(isAuthError(new Error('connect ECONNREFUSED 127.0.0.1:27017'))).toBe(false)
    expect(isAuthError(new Error('Server selection timed out'))).toBe(false)
    expect(isAuthError('boom')).toBe(false)
  })
})

describe('boundedFindLimit', () => {
  it('caps a user limit above maxRows at maxRows+1 (truncation sentinel)', () => {
    expect(boundedFindLimit(100_000, 500)).toBe(501)
  })

  it('passes through a user limit at or below maxRows', () => {
    expect(boundedFindLimit(10, 500)).toBe(10)
  })

  it('falls back to the cap when no limit is given — including mongo\'s limit-0 "no limit"', () => {
    expect(boundedFindLimit(undefined, 500)).toBe(501)
    expect(boundedFindLimit(0, 500)).toBe(501)
  })
})

describe('boundedPipeline', () => {
  const agg = (pipeline: Record<string, unknown>[]): MongoCommand => ({
    op: 'aggregate', collection: 'c', pipeline
  })

  it('appends a terminal $limit to read pipelines', () => {
    expect(boundedPipeline(agg([{ $match: { a: 1 } }]), 500)).toEqual([
      { $match: { a: 1 } },
      { $limit: 501 }
    ])
  })

  it('leaves $out/$merge pipelines untouched — those stages must stay terminal', () => {
    const out = [{ $match: { a: 1 } }, { $out: 'target' }]
    expect(boundedPipeline(agg(out), 500)).toEqual(out)
    const merge = [{ $merge: { into: 'target' } }]
    expect(boundedPipeline(agg(merge), 500)).toEqual(merge)
  })
})
