import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'

/**
 * Async key/value persistence. In the browser this is localStorage; in the
 * Capacitor app it's native storage (Preferences), which the OS won't evict
 * the way it can a WebView's localStorage.
 */
export interface KeyValueStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
}

const webStore: KeyValueStore = {
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

const nativeStore: KeyValueStore = {
  get: async (key) => (await Preferences.get({ key })).value,
  set: (key, value) => Preferences.set({ key, value }),
}

export const kv = Capacitor.isNativePlatform() ? nativeStore : webStore

/** Ask the browser not to evict our data under storage pressure. */
export function requestPersistence() {
  if (Capacitor.isNativePlatform()) return
  void navigator.storage?.persist?.().catch(() => {})
}
