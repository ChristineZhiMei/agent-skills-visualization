import { app, shell, BrowserWindow, ipcMain, Menu, dialog } from 'electron'
import { join } from 'path'
import { readdir, readFile, access } from 'fs/promises'
import type { Dirent } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { parseSkillMd } from '../shared/parseSkillMd'

const SKILL_FILENAME = 'SKILL.md'

/** 将路径中的 ~ 展开为用户主目录（便于对话框内手动填写） */
function resolvePath(inputPath: string): string {
  const trimmed = inputPath.trim()
  if (trimmed.startsWith('~')) {
    return join(app.getPath('home'), trimmed.slice(1).replace(/^\//, ''))
  }
  return trimmed
}

/** 扫描目录下各子文件夹中的 SKILL.md，汇总为 { path, skills[] } */
async function scanFolderForSkills(dirPath: string): Promise<{
  path: string
  skills: { name: string; description: string }[]
}> {
  const resolvedPath = resolvePath(dirPath)
  const skills: { name: string; description: string }[] = []
  let entries: Dirent[] = []
  try {
    entries = await readdir(resolvedPath, { withFileTypes: true })
  } catch {
    return { path: resolvedPath, skills: [] }
  }

  for (const ent of entries) {
    if (!ent.isDirectory()) continue
    const skillPath = join(resolvedPath, ent.name, SKILL_FILENAME)
    try {
      await access(skillPath)
    } catch {
      // 不存在 SKILL.md 则不读取、不加入列表
      continue
    }
    try {
      const content = await readFile(skillPath, 'utf-8')
      const parsed = parseSkillMd(content)
      if (parsed) skills.push(parsed)
    } catch {
      // 读失败则跳过
    }
  }

  return { path: resolvedPath, skills }
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    // 开发与生产环境统一使用同一套应用图标
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// IPC 在主进程启动时即注册，避免开发环境下渲染进程先于 whenReady 调用导致 "No handler registered"
ipcMain.on('ping', () => console.log('pong'))

ipcMain.handle('api:openFolderDialog', async () => {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (win) {
    win.focus()
    if (win.isMinimized()) win.restore()
  }
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
    defaultPath: app.getPath('home'),
    title: '选择 skill 根目录'
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('api:scanFolderForSkills', async (_, dirPath: string) => {
  return scanFolderForSkills(dirPath)
})

app.whenReady().then(() => {
  // 设置应用展示名称与 Windows UserModelId
  app.setName('Agent Skills Visualization')
  electronApp.setAppUserModelId('com.agent-skills-visualization.app')

  // 在 macOS 上同步 Dock 图标为项目自带图标，便于开发调试时观察
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(join(__dirname, '../../resources/icon.png'))
  }

  // 设置并保留应用菜单引用，避免 macOS 上 representedObject WeakPtr 相关控制台警告
  if (process.platform === 'darwin') {
    const appMenu = Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: 'about' as const },
          { type: 'separator' as const },
          { role: 'quit' as const }
        ]
      },
      { role: 'editMenu' as const },
      { role: 'viewMenu' as const },
      { role: 'windowMenu' as const }
    ])
    Menu.setApplicationMenu(appMenu)
  }

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
