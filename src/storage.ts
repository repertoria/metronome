/**
 * Async key/value persistence. In the browser this is localStorage; for a
 * Capacitor build, swap in @capacitor/preferences, which has the same
 * get/set shape and keeps data in native storage the OS won't evict:
 *
 *   import { Preferences } from '@capacitor/preferences'
 *   export const kv: KeyValueStore = {
 *     get: async (key) => (await Preferences.get({ key })).value,
 *     set: (key, value) => Preferences.set({ key, value }),
 *   }
 */
export interface KeyValueStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
}

export const kv: KeyValueStore = {
  async get(key) {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  async set(key, value) {
    try {
      localStorage.setItem(key, value)
    } catch {
      // storage unavailable (private mode); data just won't persist
    }
  },
}

/** Ask the browser not to evict our data under storage pressure. */
export function requestPersistence() {
  void navigator.storage?.persist?.().catch(() => {})
}
