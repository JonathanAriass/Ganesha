import type { DbClientApi } from '../shared/api'

declare global {
  interface Window {
    api: DbClientApi
  }
}
