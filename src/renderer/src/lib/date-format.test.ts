import { describe, it, expect } from 'vitest'
import { dateColumnKind, formatDbDate, displayCellText, cellMatchesDateAware } from './date-format'

describe('dateColumnKind', () => {
  it('maps postgres date/time/timestamp OIDs', () => {
    expect(dateColumnKind('1082', 'postgres')).toBe('date')
    expect(dateColumnKind('1083', 'postgres')).toBe('time')
    expect(dateColumnKind('1266', 'postgres')).toBe('time') // timetz
    expect(dateColumnKind('1114', 'postgres')).toBe('datetime')
    expect(dateColumnKind('1184', 'postgres')).toBe('datetime') // timestamptz
  })
  it('does NOT reformat postgres interval (1186)', () => {
    expect(dateColumnKind('1186', 'postgres')).toBeNull()
  })
  it('maps mysql date/time/datetime type codes', () => {
    expect(dateColumnKind('10', 'mysql')).toBe('date') // DATE
    expect(dateColumnKind('14', 'mysql')).toBe('date') // NEWDATE
    expect(dateColumnKind('11', 'mysql')).toBe('time') // TIME
    expect(dateColumnKind('7', 'mysql')).toBe('datetime') // TIMESTAMP
    expect(dateColumnKind('12', 'mysql')).toBe('datetime') // DATETIME
  })
  it('does NOT reformat mysql YEAR (13)', () => {
    expect(dateColumnKind('13', 'mysql')).toBeNull()
  })
  it('null for unknown codes, null dataType, or wrong-dialect codes', () => {
    expect(dateColumnKind('25', 'postgres')).toBeNull() // text
    expect(dateColumnKind('1114', 'mysql')).toBeNull() // a pg OID under the mysql dialect
    expect(dateColumnKind(null, 'postgres')).toBeNull()
  })
})

describe('formatDbDate', () => {
  it('datetime → day-first, dropping fractional seconds and the tz offset', () => {
    expect(formatDbDate('2024-06-24 14:30:00.123456+00', 'datetime')).toBe('24-06-2024 14:30:00')
    expect(formatDbDate('2024-06-24 14:30:00', 'datetime')).toBe('24-06-2024 14:30:00')
  })
  it('datetime → accepts an ISO "T" separator', () => {
    expect(formatDbDate('2024-06-24T09:05:01.5Z', 'datetime')).toBe('24-06-2024 09:05:01')
  })
  it('date → day-first', () => {
    expect(formatDbDate('2024-06-24', 'date')).toBe('24-06-2024')
  })
  it('time → HH:MM:SS, dropping fractional and tz', () => {
    expect(formatDbDate('14:30:00.5', 'time')).toBe('14:30:00')
    expect(formatDbDate('14:30:00+00', 'time')).toBe('14:30:00')
  })
  it('passes through values that do not match the kind shape', () => {
    expect(formatDbDate('838:59:59', 'time')).toBe('838:59:59') // mysql out-of-range TIME
    expect(formatDbDate('not a date', 'datetime')).toBe('not a date')
    expect(formatDbDate('2024-06-24', 'datetime')).toBe('2024-06-24') // datetime needs a time part
  })
  it('passes non-strings through cellText', () => {
    expect(formatDbDate(null, 'datetime')).toBe('') // cellText(null) === ''
    expect(formatDbDate(42, 'date')).toBe('42')
  })
})

describe('displayCellText', () => {
  it('formats when a kind is given, else falls back to raw cellText', () => {
    expect(displayCellText('2024-06-24 14:30:00', 'datetime')).toBe('24-06-2024 14:30:00')
    expect(displayCellText('2024-06-24 14:30:00', null)).toBe('2024-06-24 14:30:00')
    expect(displayCellText({ a: 1 }, null)).toBe('{"a":1}') // objects stringify via cellText
  })
})

describe('cellMatchesDateAware', () => {
  it('matches the formatted display spelling', () => {
    expect(cellMatchesDateAware('2024-06-24 14:30:00', 'datetime', '24-06-2024')).toBe(true)
  })
  it('still matches the raw stored spelling', () => {
    expect(cellMatchesDateAware('2024-06-24 14:30:00', 'datetime', '2024-06-24')).toBe(true)
  })
  it('non-date columns match the raw text only', () => {
    expect(cellMatchesDateAware('hello', null, 'ell')).toBe(true)
    expect(cellMatchesDateAware('hello', null, 'xyz')).toBe(false)
  })
})
