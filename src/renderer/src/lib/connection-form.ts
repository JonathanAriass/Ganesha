import type { ConnectionType } from '@shared/domain'

/** The engines the connection form offers, in display order. */
export const ENGINES: Array<{ type: ConnectionType; label: string }> = [
  { type: 'postgres', label: 'PostgreSQL' },
  { type: 'mysql', label: 'MySQL' },
  { type: 'mariadb', label: 'MariaDB' },
  { type: 'mongodb', label: 'MongoDB' }
]

export const DEFAULT_PORTS: Record<ConnectionType, number> = {
  postgres: 5432,
  mysql: 3306,
  mariadb: 3306,
  mongodb: 27017
}

/** The port to show after switching engine: the new engine's default, unless the user had
 *  already moved the port off the previous engine's default (then it is theirs to keep). */
export function portAfterEngineChange(prev: ConnectionType, next: ConnectionType, port: number): number {
  return port === DEFAULT_PORTS[prev] ? DEFAULT_PORTS[next] : port
}

/** Why the form can't be saved or tested yet, in the user's words; null = it can. */
export function connectionFormProblem(form: { name: string; host: string; port: number }): string | null {
  if (form.name.trim() === '') return 'Give the connection a name'
  if (form.host.trim() === '') return 'Enter the server host'
  if (!Number.isInteger(form.port) || form.port < 1 || form.port > 65535) return 'Port must be between 1 and 65535'
  return null
}
