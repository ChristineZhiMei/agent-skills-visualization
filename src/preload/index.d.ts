import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      openFolderDialog: () => Promise<string | null>
      scanFolderForSkills: (
        dirPath: string
      ) => Promise<{ path: string; skills: { name: string; description: string }[] }>
    }
  }
}
