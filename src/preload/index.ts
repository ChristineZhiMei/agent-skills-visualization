import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  openFolderDialog: (): Promise<string | null> => ipcRenderer.invoke('api:openFolderDialog'),
  scanFolderForSkills: (
    dirPath: string
  ): Promise<{ path: string; skills: { name: string; description: string }[] }> =>
    ipcRenderer.invoke('api:scanFolderForSkills', dirPath)
}

const exposeElectron = () => {
  ;(window as unknown as { __ELECTRON__?: boolean }).__ELECTRON__ = true
}
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
    exposeElectron()
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
  exposeElectron()
}
