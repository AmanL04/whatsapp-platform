import type { SQLiteStore } from '../adapters/baileys/store'

/**
 * Delete webhook delivery logs older than maxAgeDays.
 * Returns the number of rows deleted.
 */
export function cleanOldDeliveries(store: SQLiteStore, maxAgeDays = 30): number {
  const cutoff = Math.floor(Date.now() / 1000) - (maxAgeDays * 86400)
  return store.deleteOldDeliveries(cutoff)
}
