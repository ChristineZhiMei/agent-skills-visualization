export interface StorageService {
  getItem<T>(key: string): T | null
  setItem<T>(key: string, value: T): void
}

export function createStorageService(): StorageService {
  return {
    getItem<T>(key: string): T | null {
      try {
        const raw = localStorage.getItem(key)
        if (raw == null) return null
        return JSON.parse(raw) as T
      } catch {
        return null
      }
    },
    setItem<T>(key: string, value: T): void {
      try {
        localStorage.setItem(key, JSON.stringify(value))
      } catch (e) {
        if (e instanceof DOMException && e.name === 'QuotaExceededError') {
          console.warn('localStorage quota exceeded')
        }
      }
    }
  }
}
