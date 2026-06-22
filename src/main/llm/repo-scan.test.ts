import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { scanRepoFiles, readRepoFile } from './repo-scan'

let root: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'repo-scan-'))
  mkdirSync(join(root, 'app', 'Models'), { recursive: true })
  mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true })
  mkdirSync(join(root, '.git'), { recursive: true })
  writeFileSync(join(root, 'app', 'Models', 'User.php'), '<?php class User {}')
  writeFileSync(join(root, 'schema.sql'), 'CREATE TABLE users();')
  writeFileSync(join(root, 'logo.png'), 'PNGDATA') // binary ext — skipped
  writeFileSync(join(root, '.env'), 'SECRET=1') // dotfile — skipped
  writeFileSync(join(root, 'node_modules', 'pkg', 'index.js'), 'module.exports={}') // dep dir — skipped
  writeFileSync(join(root, '.git', 'HEAD'), 'ref: x') // dot dir — skipped
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('scanRepoFiles', () => {
  it('returns source files as forward-slashed relative paths, skipping deps/dot/binary', () => {
    const files = scanRepoFiles(root).sort()
    expect(files).toEqual(['app/Models/User.php', 'schema.sql'])
  })
})

describe('readRepoFile', () => {
  it('reads a file inside the repo', () => {
    expect(readRepoFile(root, 'app/Models/User.php')).toContain('class User')
  })
  it('allows paths that normalize back inside the repo', () => {
    expect(readRepoFile(root, 'app/../schema.sql')).toContain('CREATE TABLE')
  })
  it('refuses traversal outside the repo', () => {
    writeFileSync(join(root, '..', 'outside-secret.txt'), 'TOPSECRET')
    expect(readRepoFile(root, '../outside-secret.txt')).toBeNull()
    rmSync(join(root, '..', 'outside-secret.txt'), { force: true })
  })
  it('returns null for a missing file', () => {
    expect(readRepoFile(root, 'nope.php')).toBeNull()
  })
})
