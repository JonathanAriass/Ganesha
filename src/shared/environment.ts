export const ENVIRONMENT_MAX_LENGTH = 12
export const ENVIRONMENT_SUGGESTIONS = ['PROD', 'STG', 'DEV', 'LOCAL'] as const

/** Normalise a connection's free-text environment label: trimmed and capped; non-strings become ''. */
export function cleanEnvironment(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().slice(0, ENVIRONMENT_MAX_LENGTH) : ''
}
