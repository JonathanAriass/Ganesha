/** Per-tunnel SSM output is buffered for the app's lifetime, so each buffer is capped. */
export const SSM_OUTPUT_MAX = 200_000

/** Append `chunk` to `prev`, keeping only the last `max` characters. */
export function appendCapped(prev: string, chunk: string, max: number): string {
  const next = prev + chunk
  return next.length > max ? next.slice(next.length - max) : next
}
