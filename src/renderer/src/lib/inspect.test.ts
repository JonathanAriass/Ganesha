import { describe, it, expect } from 'vitest'
import { fieldView, rowJson, positionLabel } from './inspect'

describe('fieldView', () => {
  it('pretty-prints objects, copy matches the display', () => {
    const f = fieldView({ a: 1, b: [2, 3] })
    expect(f.text).toBe('{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}')
    expect(f.copyText).toBe(f.text)
    expect(f.formatted).toBe(false) // real objects aren't "reformatted strings"
    expect(f.isNull).toBe(false)
  })

  it('formats a JSON-document string but copies the original bytes', () => {
    const raw = '{"a":1,"b":"x"}'
    const f = fieldView(raw)
    expect(f.formatted).toBe(true)
    expect(f.text).toBe('{\n  "a": 1,\n  "b": "x"\n}')
    expect(f.copyText).toBe(raw)
  })

  it('formats a JSON-array string', () => {
    const f = fieldView('[1, 2]')
    expect(f.formatted).toBe(true)
    expect(f.text).toBe('[\n  1,\n  2\n]')
  })

  it('looks through leading whitespace when sniffing JSON strings', () => {
    expect(fieldView('  {"a":1}').formatted).toBe(true)
  })

  it('leaves JSON scalar strings raw — formatting "42" is noise', () => {
    expect(fieldView('42')).toMatchObject({ text: '42', formatted: false })
    expect(fieldView('true').formatted).toBe(false)
  })

  it('leaves a brace-shaped non-JSON string raw', () => {
    const f = fieldView('{not json')
    expect(f.formatted).toBe(false)
    expect(f.text).toBe('{not json')
    expect(f.copyText).toBe('{not json')
  })

  it('plain strings pass through untouched, including empty', () => {
    expect(fieldView('hello')).toMatchObject({ text: 'hello', copyText: 'hello', formatted: false })
    expect(fieldView('')).toMatchObject({ text: '', isNull: false })
  })

  it('null and undefined render NULL and copy as empty (the grid projection)', () => {
    expect(fieldView(null)).toEqual({ text: 'NULL', isNull: true, formatted: false, copyText: '' })
    expect(fieldView(undefined).isNull).toBe(true)
  })

  it('numbers and booleans stringify', () => {
    expect(fieldView(3.5).text).toBe('3.5')
    expect(fieldView(false).text).toBe('false')
  })

  it('BigInt does not throw, alone or nested in an object', () => {
    expect(fieldView(9007199254740993n).text).toBe('9007199254740993')
    expect(fieldView({ big: 9007199254740993n }).text).toContain('"big": "9007199254740993"')
  })

  it('Date (pg timestamps) renders as the quoted ISO string, same as the grid projection', () => {
    const f = fieldView(new Date('2026-06-12T00:00:00.000Z'))
    expect(f.text).toBe('"2026-06-12T00:00:00.000Z"')
    expect(f.formatted).toBe(false)
  })

  it('Uint8Array (bytea) renders as its numeric-key object', () => {
    expect(fieldView(new Uint8Array([1, 2])).text).toBe('{\n  "0": 1,\n  "1": 2\n}')
  })

  it('whitespace-wrapped JSON strings format but copy the exact original bytes', () => {
    const raw = '  {"a":1}  '
    const f = fieldView(raw)
    expect(f.formatted).toBe(true)
    expect(f.copyText).toBe(raw)
  })
})

describe('rowJson', () => {
  const cols = (...names: string[]): { name: string; dataType: string | null }[] =>
    names.map((name) => ({ name, dataType: null }))

  it('builds a pretty {column: value} object', () => {
    expect(rowJson(cols('id', 'name'), [1, 'ada'])).toBe('{\n  "id": 1,\n  "name": "ada"\n}')
  })

  it('duplicate column names collapse last-wins, matching the JSON export', () => {
    expect(JSON.parse(rowJson(cols('a', 'a'), [1, 2]))).toEqual({ a: 2 })
  })

  it('survives BigInt values', () => {
    expect(JSON.parse(rowJson(cols('n'), [123n]))).toEqual({ n: '123' })
  })
})

describe('positionLabel', () => {
  it('is 1-based over the current view', () => {
    expect(positionLabel(0, 7)).toBe('Row 1 of 7')
    expect(positionLabel(6, 7)).toBe('Row 7 of 7')
  })

  it('says so when the filter hides the inspected row', () => {
    expect(positionLabel(-1, 3)).toBe('Filtered out')
  })
})
