import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import log from 'electron-log/main'
import { registerIpcHandlers } from './ipc/registerHandlers'

// Bridges renderer-side `electron-log/renderer` calls to this same file automatically (see
// docs/initialize.md's "most common case" — a bundler + contextIsolation, exactly this app's
// setup) by injecting its own preload script into every session; coexists with this app's own
// custom preload (`src/preload/index.ts`) rather than replacing it. `showDialog: false` on the
// error handler is deliberate — a native crash dialog popping up mid-testing would be more
// alarming than useful; the point of this is to capture problems quietly so a tester can export
// the log afterward, not interrupt them the moment something goes wrong.
log.initialize()
log.errorHandler.startCatching({ showDialog: false })

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  log.info(
    `App ready — version ${app.getVersion()}, Electron ${process.versions.electron}, ${process.platform} ${process.arch}`
  )
  electronApp.setAppUserModelId('com.sethbonser.dockersandboxgui')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpcHandlers()

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
