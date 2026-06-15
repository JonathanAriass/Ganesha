import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { listLocalModels, deleteLocalModel } from './models'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'models-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('local models', () => {
  it('lists only .gguf files with id=filename and their size', () => {
    writeFileSync(join(dir, 'a.gguf'), 'xxxx')
    writeFileSync(join(dir, 'notes.txt'), 'ignore me')
    const models = listLocalModels(dir)
    expect(models.map((m) => m.id)).toEqual(['a.gguf'])
    expect(models[0].name).toBe('a')
    expect(models[0].sizeBytes).toBe(4)
    expect(models[0].path).toBe(join(dir, 'a.gguf'))
  })

  it('returns [] for a missing directory', () => {
    expect(listLocalModels(join(dir, 'nope'))).toEqual([])
  })

  it('deletes a model by id and refuses to escape the dir', () => {
    writeFileSync(join(dir, 'a.gguf'), 'x')
    deleteLocalModel(dir, 'a.gguf')
    expect(existsSync(join(dir, 'a.gguf'))).toBe(false)
    expect(() => deleteLocalModel(dir, '../escape')).toThrow(/invalid model id/i)
  })
})
