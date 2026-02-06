import { parseSkillMd } from '../../../shared/parseSkillMd'

const SKILL_FILENAME = 'SKILL.md'
const IDB_NAME = 'agent-skills-web-handles'
const IDB_STORE = 'handles'

export interface ScanResult {
  path: string
  skills: { name: string; description: string }[]
}

export interface FileService {
  openFolder(): Promise<ScanResult | null>
  refreshFolder(pathOrId: string): Promise<ScanResult | null>
  supportsLocalFolder(): boolean
  restoreHandles?(paths: string[]): Promise<void>
  removeHandle?(pathOrId: string): void
}

function createElectronFileService(): FileService {
  const api = (window as unknown as {
    api?: {
      openFolderDialog: () => Promise<string | null>
      scanFolderForSkills: (path: string) => Promise<{ path: string; skills: { name: string; description: string }[] }>
    }
  }).api

  return {
    async openFolder(): Promise<ScanResult | null> {
      if (!api?.openFolderDialog || !api?.scanFolderForSkills) {
        return Promise.reject(new Error('无法调用：api 未就绪'))
      }
      const dirPath = await api.openFolderDialog()
      if (!dirPath) return null
      return api.scanFolderForSkills(dirPath)
    },
    async refreshFolder(path: string): Promise<ScanResult | null> {
      if (!api?.scanFolderForSkills) return Promise.reject(new Error('无法刷新：api 未就绪'))
      return api.scanFolderForSkills(path)
    },
    supportsLocalFolder(): boolean {
      return !!api?.openFolderDialog && !!api?.scanFolderForSkills
    }
  }
}

async function idbGetHandle(id: string): Promise<FileSystemDirectoryHandle | null> {
  return new Promise((resolve) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onerror = () => resolve(null)
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE)
    }
    req.onsuccess = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.close()
        resolve(null)
        return
      }
      const tx = db.transaction(IDB_STORE, 'readonly')
      const getReq = tx.objectStore(IDB_STORE).get(id)
      getReq.onerror = () => { db.close(); resolve(null) }
      getReq.onsuccess = () => {
        db.close()
        resolve(getReq.result ?? null)
      }
    }
  })
}

async function idbPutHandle(id: string, handle: FileSystemDirectoryHandle): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onerror = () => reject(req.error)
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE)
    }
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction(IDB_STORE, 'readwrite')
      tx.objectStore(IDB_STORE).put(handle, id)
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => reject(tx.error)
    }
  })
}

async function idbDeleteHandle(id: string): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onerror = () => resolve()
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE)
    }
    req.onsuccess = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(IDB_STORE)) { db.close(); resolve(); return }
      const tx = db.transaction(IDB_STORE, 'readwrite')
      tx.objectStore(IDB_STORE).delete(id)
      tx.oncomplete = () => { db.close(); resolve() }
    }
  })
}

function createWebFileService(): FileService {
  const handleMap = new Map<string, FileSystemDirectoryHandle>()

  async function scanFromHandle(handle: FileSystemDirectoryHandle, displayPath: string): Promise<ScanResult> {
    const skills: { name: string; description: string }[] = []
    for await (const [_name, entry] of handle.entries()) {
      if (entry.kind !== 'directory') continue
      try {
        const fileHandle = await (entry as FileSystemDirectoryHandle).getFileHandle(SKILL_FILENAME)
        const file = await fileHandle.getFile()
        const content = await file.text()
        const parsed = parseSkillMd(content)
        if (parsed) skills.push(parsed)
      } catch {
        /* skip */
      }
    }
    return { path: displayPath, skills }
  }

  return {
    async openFolder(): Promise<ScanResult | null> {
      if (typeof (window as Window).showDirectoryPicker !== 'function') {
        return Promise.reject(new Error('当前浏览器不支持选择本地目录，请使用 Chrome 或 Edge'))
      }
      try {
        const handle = await (window as Window).showDirectoryPicker!({ mode: 'read' })
        for (const [existingId, existingHandle] of handleMap) {
          if (await handle.isSameEntry(existingHandle)) {
            return scanFromHandle(handle, existingId)
          }
        }
        const id = `__web__${handle.name}__${crypto.randomUUID().slice(0, 8)}`
        handleMap.set(id, handle)
        try { await idbPutHandle(id, handle) } catch (e) { console.warn('句柄持久化失败:', e) }
        return scanFromHandle(handle, id)
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') return null
        throw e
      }
    },
    async refreshFolder(pathOrId: string): Promise<ScanResult | null> {
      let handle: FileSystemDirectoryHandle | null | undefined = handleMap.get(pathOrId)
      if (!handle) {
        handle = await idbGetHandle(pathOrId)
        if (handle) handleMap.set(pathOrId, handle)
      }
      if (!handle) return Promise.reject(new Error('无法刷新：目录句柄已失效，请重新添加'))
      // 刷新时重新请求读权限，确保按当前目录重新访问并读取文件（避免使用缓存）
      const h = handle as FileSystemHandle & {
        queryPermission?(opts: { mode: string }): Promise<string>
        requestPermission?(opts: { mode: string }): Promise<string>
      }
      if (typeof h.queryPermission === 'function') {
        const state = await h.queryPermission({ mode: 'read' })
        if (state !== 'granted' && typeof h.requestPermission === 'function') {
          const granted = await h.requestPermission({ mode: 'read' })
          if (granted !== 'granted') return Promise.reject(new Error('无法刷新：需要重新授权读取该目录'))
        }
      }
      return scanFromHandle(handle, pathOrId)
    },
    supportsLocalFolder(): boolean {
      return typeof (window as Window).showDirectoryPicker === 'function'
    },
    async restoreHandles(paths: string[]): Promise<void> {
      for (const id of paths.filter((p) => p.startsWith('__web__'))) {
        const handle = await idbGetHandle(id)
        if (handle) handleMap.set(id, handle)
      }
    },
    removeHandle(pathOrId: string): void {
      if (!pathOrId.startsWith('__web__')) return
      handleMap.delete(pathOrId)
      idbDeleteHandle(pathOrId).catch(() => {})
    }
  }
}

export function createFileService(isElectronEnv: boolean): FileService {
  return isElectronEnv ? createElectronFileService() : createWebFileService()
}
