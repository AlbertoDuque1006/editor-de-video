import { readFileSync, writeFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, Menu, MenuItem, screen, shell, systemPreferences, type MenuItemConstructorOptions } from 'electron'
import type { ExportEvent, ExportVideoDone, MediaItem, Project } from '../shared/types'
import { cancelAi, claudeStatus, openClaudeLogin, runAi, type AiRequest } from './claude'
import { abortExport, beginExport, finishExport, writeExportChunk } from './export'
import { dataDir } from './env'
import { makeProxy, MEDIA_EXTENSIONS, needsProxy, probe } from './media'
import { loadProjectData } from './projectFile'
import { handleMediaProtocol, registerMediaScheme } from './protocol'
import { loadSettings, saveSettings, type Settings } from './settings'
import { stopTranscriber, transcribe, WHISPER_MODELS } from './transcribe'

const PROJECT_EXT = 'edvideo'
type CtxItem = { id: string; label: string; enabled?: boolean; checked?: boolean; accelerator?: string } | { type: 'separator' }
type ConfirmOptions = { message: string; detail?: string; confirm: string; cancel?: string; destructive?: boolean }

registerMediaScheme()

const dirtyWindows = new Set<number>()

// La ventana vuelve con el tamaño y el lugar donde se dejó, si ese lugar sigue en alguna pantalla.
const boundsFile = () => join(dataDir(), 'ventana.json')
function savedBounds(): { x?: number; y?: number; width: number; height: number; maximized?: boolean } {
  const fallback = { width: 1500, height: 940 }
  try {
    const b = JSON.parse(readFileSync(boundsFile(), 'utf8'))
    if (![b.x, b.y, b.width, b.height].every(Number.isFinite)) return fallback
    const visible = screen.getAllDisplays().some(({ workArea: a }) => b.x < a.x + a.width - 100 && b.x + b.width > a.x + 100 && b.y >= a.y - 10 && b.y < a.y + a.height - 100)
    return visible ? b : { ...fallback, width: b.width, height: b.height }
  } catch {
    return fallback
  }
}

function createWindow(): BrowserWindow {
  const { maximized, ...bounds } = savedBounds()
  const win = new BrowserWindow({
    ...bounds,
    minWidth: 1100,
    minHeight: 700,
    ...(process.platform === 'darwin' ? {
      titleBarStyle: 'hiddenInset' as const,
      trafficLightPosition: { x: 18, y: 18 },
      vibrancy: 'sidebar' as const,
      visualEffectState: 'followWindow' as const,
      backgroundColor: '#00000000'
    } : {
      titleBarStyle: 'hidden' as const,
      titleBarOverlay: { color: '#1f1f22', symbolColor: '#e6e6e6', height: 52 },
      backgroundColor: '#161618'
    }),
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
      message: '¿Cerrar sin guardar los cambios?',
      detail: 'Si cierras ahora, se pierden los cambios de este proyecto.'
    })
    if (choice === 0) e.preventDefault()
    else dirtyWindows.delete(win.webContents.id)
  })
  if (maximized) win.maximize()
  const remember = () => {
    try {
      writeFileSync(boundsFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }))
    } catch {
      // No es grave: la próxima vez abre con el tamaño de siempre.
    }
  }
  win.on('close', remember)
  win.on('enter-full-screen', () => win.webContents.send('window:fullscreen', true))
  win.on('leave-full-screen', () => win.webContents.send('window:fullscreen', false))
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
    ...(isMac ? [{
      role: 'appMenu' as const,
      label: app.name,
      submenu: [
        { role: 'about' as const },
        { type: 'separator' as const },
        { label: 'Ajustes…', accelerator: 'CmdOrCtrl+,', click: send('settings') },
        { type: 'separator' as const },
        { role: 'services' as const },
        { type: 'separator' as const },
        { role: 'hide' as const },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        { role: 'quit' as const }
      ]
    }] : []),
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
        ...(!isMac ? [
          { type: 'separator' as const },
          { label: 'Ajustes…', accelerator: 'CmdOrCtrl+,', click: send('settings') }
        ] : []),
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
        { role: 'selectAll', label: 'Seleccionar todo' },
        { type: 'separator' },
        { label: 'Duplicar', accelerator: 'CmdOrCtrl+D', click: send('duplicate') }
      ]
    },
    {
      label: 'Ver',
      submenu: [
        { label: 'Archivos', accelerator: 'CmdOrCtrl+1', click: send('panelMedia') },
        { label: 'Asistente IA', accelerator: 'CmdOrCtrl+2', click: send('panelAi') },
        { label: 'Mostrar u ocultar barra lateral', accelerator: isMac ? 'Ctrl+Cmd+S' : 'Ctrl+Alt+S', click: send('toggleSidebar') },
        { label: 'Mostrar u ocultar inspector', accelerator: 'CmdOrCtrl+4', click: send('toggleInspector') },
        { type: 'separator' },
        { label: 'Acercar línea de tiempo', accelerator: 'CmdOrCtrl+=', click: send('zoomIn') },
        { label: 'Alejar línea de tiempo', accelerator: 'CmdOrCtrl+-', click: send('zoomOut') },
        { label: 'Ajustar línea de tiempo a la ventana', accelerator: 'CmdOrCtrl+0', click: send('zoomFit') },
        { type: 'separator' },
        { label: 'Zona segura de redes', click: send('safe') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Pantalla completa' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' as const }])
      ]
    },
    { role: 'windowMenu', label: 'Ventana' },
    { role: 'help', label: 'Ayuda', submenu: [
      { label: 'Atajos de teclado', accelerator: 'CmdOrCtrl+/', click: send('shortcuts') }
    ] }
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
  ipcMain.on('project:dirty', (e, dirty: boolean) => {
    if (dirty) dirtyWindows.add(e.sender.id)
    else dirtyWindows.delete(e.sender.id)
    if (process.platform === 'darwin') winOf(e).setDocumentEdited(dirty)
  })
  ipcMain.on('project:file', (e, path: string | null) => {
    if (path !== null && typeof path !== 'string') return
    if (process.platform === 'darwin') winOf(e).setRepresentedFilename(path ?? '')
  })

  ipcMain.handle('dialog:confirm', async (e, opts: ConfirmOptions) => {
    if (!opts || typeof opts !== 'object' || typeof opts.message !== 'string' || typeof opts.confirm !== 'string' ||
        (opts.detail !== undefined && typeof opts.detail !== 'string') ||
        (opts.cancel !== undefined && typeof opts.cancel !== 'string') ||
        (opts.destructive !== undefined && typeof opts.destructive !== 'boolean')) return false
    const { response } = await dialog.showMessageBox(winOf(e), {
      type: 'warning',
      message: opts.message,
      detail: opts.detail,
      buttons: [opts.confirm, opts.cancel ?? 'Cancelar'],
      // Si confirmar borra algo, el botón por defecto es Cancelar (Esc también cancela).
      defaultId: opts.destructive ? 1 : 0,
      cancelId: 1
    })
    return response === 0
  })
  ipcMain.handle('menu:context', (e, items: CtxItem[]): Promise<string | null> => {
    if (!Array.isArray(items)) return Promise.resolve(null)
    const menu = new Menu()
    let resolve: (id: string | null) => void = () => {}
    const chosen = new Promise<string | null>((r) => (resolve = r))
    for (const item of items) {
      if (!item || typeof item !== 'object') continue
      if ('type' in item) {
        if (item.type === 'separator') menu.append(new MenuItem({ type: 'separator' }))
        continue
      }
      if (typeof item.id !== 'string' || typeof item.label !== 'string' ||
          (item.enabled !== undefined && typeof item.enabled !== 'boolean') ||
          (item.checked !== undefined && typeof item.checked !== 'boolean') ||
          (item.accelerator !== undefined && typeof item.accelerator !== 'string')) continue
      menu.append(new MenuItem({
        label: item.label,
        type: item.checked !== undefined ? 'checkbox' : 'normal',
        enabled: item.enabled,
        checked: item.checked,
        accelerator: item.accelerator,
        registerAccelerator: false,
        click: () => resolve(item.id)
      }))
    }
    if (menu.items.length === 0) return Promise.resolve(null)
    // En Mac el menú puede avisar que se cerró antes que el clic: se espera un poco antes de dar «nada».
    menu.popup({ window: winOf(e), callback: () => setTimeout(() => resolve(null), 100) })
    return chosen
  })

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

  // Color de resalte del sistema (RRGGBBAA); en Linux no existe.
  ipcMain.handle('system:accent', () => (process.platform === 'linux' ? null : `#${systemPreferences.getAccentColor().slice(0, 6)}`))

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
  // Empaquetada, el ícono lo pone electron-builder (build/icon.png); en desarrollo se pone a mano en el Dock.
  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(join(__dirname, '../../build/icon.png'))
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
