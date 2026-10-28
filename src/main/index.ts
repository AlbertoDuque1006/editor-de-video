import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import type { ExportEvent, ExportVideoDone, MediaItem, Project } from '../shared/types'
import { cancelAi, claudeStatus, openClaudeLogin, runAi, type AiRequest } from './claude'
import { abortExport, beginExport, finishExport, writeExportChunk } from './export'
import { makeProxy, MEDIA_EXTENSIONS, needsProxy, probe } from './media'
import { loadProjectData } from './projectFile'
import { handleMediaProtocol, registerMediaScheme } from './protocol'
import { loadSettings, saveSettings, type Settings } from './settings'
import { stopTranscriber, transcribe, WHISPER_MODELS } from './transcribe'

const PROJECT_EXT = 'edvideo'

registerMediaScheme()

const dirtyWindows = new Set<number>()

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1180,
    minHeight: 720,
    backgroundColor: '#111216',
    title: 'Editor de Video',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true
    }
  })
  // Con cambios sin guardar, se pregunta antes de cerrar.
  win.on('close', (e) => {
    if (!dirtyWindows.has(win.webContents.id)) return
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Cancelar', 'Cerrar sin guardar'],
      defaultId: 0,
      cancelId: 0,
      message: 'Hay cambios sin guardar.',
      detail: 'Si cierras ahora, se pierden.'
    })
    if (choice === 0) e.preventDefault()
    else dirtyWindows.delete(win.webContents.id)
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

async function probeMany(paths: string[]): Promise<MediaItem[]> {
  const items = await Promise.all(paths.map((p) => probe(p).catch(() => null)))
  return items.filter((i) => i !== null)
}

const winOf = (e: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) => BrowserWindow.fromWebContents(e.sender)!

// Los atajos de deshacer/guardar/exportar los atiende la interfaz; el menú solo le avisa.
function buildMenu(): void {
  const send = (cmd: string) => () => BrowserWindow.getFocusedWindow()?.webContents.send('menu', cmd)
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'Archivo',
      submenu: [
        { label: 'Proyecto nuevo', accelerator: 'CmdOrCtrl+N', click: send('new') },
        { label: 'Abrir proyecto…', accelerator: 'CmdOrCtrl+O', click: send('open') },
        { type: 'separator' },
        { label: 'Guardar', accelerator: 'CmdOrCtrl+S', click: send('save') },
        { label: 'Guardar como…', accelerator: 'Shift+CmdOrCtrl+S', click: send('saveAs') },
        { type: 'separator' },
        { label: 'Importar archivos…', accelerator: 'CmdOrCtrl+I', click: send('import') },
        { label: 'Exportar video…', accelerator: 'CmdOrCtrl+E', click: send('export') },
        { type: 'separator' },
        isMac ? { role: 'close', label: 'Cerrar ventana' } : { role: 'quit', label: 'Salir' }
      ]
    },
    {
      label: 'Edición',
      submenu: [
        { label: 'Deshacer', accelerator: 'CmdOrCtrl+Z', click: send('undo') },
        { label: 'Rehacer', accelerator: isMac ? 'Shift+Cmd+Z' : 'Ctrl+Y', click: send('redo') },
        { type: 'separator' },
        { role: 'cut', label: 'Cortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Pegar' },
        { role: 'selectAll', label: 'Seleccionar todo' }
      ]
    },
    {
      label: 'Ver',
      submenu: [
        { role: 'resetZoom', label: 'Tamaño real' },
        { role: 'zoomIn', label: 'Acercar' },
        { role: 'zoomOut', label: 'Alejar' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Pantalla completa' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' as const }])
      ]
    },
    { role: 'windowMenu', label: 'Ventana' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function registerIpc(): void {
  ipcMain.handle('media:pick', async (e) => {
    const res = await dialog.showOpenDialog(winOf(e), {
      title: 'Agregar archivos',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Video, imagen o audio', extensions: MEDIA_EXTENSIONS }]
    })
    return res.canceled ? [] : probeMany(res.filePaths)
  })
  ipcMain.handle('media:probe', (_e, paths: string[]) => probeMany(paths.filter((p) => typeof p === 'string')))
  ipcMain.handle('media:needsProxy', (_e, m: MediaItem) => needsProxy(m))
  ipcMain.handle('media:makeProxy', async (e, m: MediaItem) => {
    const fresh = await probe(m.path, m.id)
    if (!fresh) throw new Error('No se pudo leer el archivo.')
    return makeProxy(fresh, (ratio) => !e.sender.isDestroyed() && e.sender.send('media:proxyProgress', m.id, ratio))
  })

  ipcMain.handle('project:save', async (e, project: Project, currentPath: string | null, saveAs: boolean) => {
    let path = currentPath
    if (!path || saveAs) {
      const res = await dialog.showSaveDialog(winOf(e), {
        title: 'Guardar proyecto',
        defaultPath: `Proyecto.${PROJECT_EXT}`,
        filters: [{ name: 'Proyecto de Editor de Video', extensions: [PROJECT_EXT] }]
      })
      if (res.canceled || !res.filePath) return null
      path = res.filePath
    }
    await writeFile(path, JSON.stringify({ version: 2, project }, null, 1), 'utf8')
    return path
  })
  ipcMain.handle('project:open', async (e) => {
    const res = await dialog.showOpenDialog(winOf(e), {
      title: 'Abrir proyecto',
      properties: ['openFile'],
      filters: [{ name: 'Proyecto de Editor de Video', extensions: [PROJECT_EXT] }]
    })
    if (res.canceled || !res.filePaths[0]) return null
    const path = res.filePaths[0]
    const { project, missing } = await loadProjectData(JSON.parse(await readFile(path, 'utf8')))
    return { project, path, missing }
  })
  ipcMain.on('project:dirty', (e, dirty: boolean) => (dirty ? dirtyWindows.add(e.sender.id) : dirtyWindows.delete(e.sender.id)))

  ipcMain.handle('export:choosePath', async (e, defaultName: string) => {
    const res = await dialog.showSaveDialog(winOf(e), {
      title: 'Exportar video',
      defaultPath: join(app.getPath('videos'), defaultName),
      filters: [{ name: 'Video MP4', extensions: ['mp4'] }]
    })
    return res.canceled ? null : (res.filePath ?? null)
  })
  ipcMain.handle('export:begin', (_e, webm: boolean) => beginExport(webm))
  ipcMain.handle('export:chunk', (_e, position: number, data: Uint8Array) => writeExportChunk(position, data))
  ipcMain.on('export:finish', (e, req: ExportVideoDone) =>
    finishExport(req, (ev: ExportEvent) => !e.sender.isDestroyed() && e.sender.send('export:event', ev))
  )
  ipcMain.on('export:abort', () => abortExport())
  ipcMain.on('shell:showItem', (_e, path: string) => shell.showItemInFolder(path))

  ipcMain.handle('settings:get', () => ({ settings: loadSettings(), whisperModels: WHISPER_MODELS }))
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => saveSettings(patch))

  ipcMain.handle('ai:status', () => claudeStatus(loadSettings().claudePath))
  ipcMain.on('ai:login', () => openClaudeLogin())
  ipcMain.handle('ai:run', (e, req: Omit<AiRequest, 'model'>) => {
    const s = loadSettings()
    return runAi({ ...req, model: s.model }, s.claudePath, (p) => !e.sender.isDestroyed() && e.sender.send('ai:progress', req.conversationId, p))
  })
  ipcMain.on('ai:cancel', (_e, conversationId: string) => cancelAi(conversationId))
  ipcMain.handle('ai:transcribe', (e, m: MediaItem) => {
    const s = loadSettings()
    return transcribe(m, s.whisperModel, s.language, (p) => !e.sender.isDestroyed() && e.sender.send('ai:transcribeProgress', m.id, p))
  })
}

app.whenReady().then(() => {
  handleMediaProtocol()
  registerIpc()
  buildMenu()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  abortExport()
  stopTranscriber()
  if (process.platform !== 'darwin') app.quit()
})
