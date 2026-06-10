import type { Result } from '@shared/result'

/** Unwrap a Result<T>, throwing an Error if the result is not ok. */
export function unwrap<T>(res: Result<T>): T {
  if (!res.ok) throw new Error(res.error)
  return res.data
}
