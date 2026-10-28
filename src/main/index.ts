import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import type { ExportRequest, Project } from '../shared/types'
import { cancelExport, startExport } from './export'
import { MEDIA_EXTENSIONS, probe } from './media'
import { handleMediaProtocol, registerMediaScheme } from './protocol'

const PROJECT_EXT = 'edvideo'

registerMediaScheme()

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#15161a',
    title: 'Editor de Video',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true
    }
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

async function probeMany(paths: string[]) {
  const items = await Promise.all(paths.map((p) => probe(p).catch(() => null)))
  return items.filter((i) => i !== null)
}

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
    const win = BrowserWindow.fromWebContents(e.sender)!
    const res = await dialog.showOpenDialog(win, {
      title: 'Agregar archivos',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Video, imagen o audio', extensions: MEDIA_EXTENSIONS }]
    })
    return res.canceled ? [] : probeMany(res.filePaths)
  })

  ipcMain.handle('media:probe', (_e, paths: string[]) => probeMany(paths))

  ipcMain.handle('project:save', async (e, project: Project, currentPath: string | null, saveAs: boolean) => {
    let path = currentPath
    if (!path || saveAs) {
      const res = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender)!, {
        title: 'Guardar proyecto',
        defaultPath: `Proyecto.${PROJECT_EXT}`,
        filters: [{ name: 'Proyecto de Editor de Video', extensions: [PROJECT_EXT] }]
      })
      if (res.canceled || !res.filePath) return null
      path = res.filePath
    }
    await writeFile(path, JSON.stringify({ version: 1, project }, null, 2), 'utf8')
    return path
  })

  ipcMain.handle('project:open', async (e) => {
    const res = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender)!, {
      title: 'Abrir proyecto',
      properties: ['openFile'],
      filters: [{ name: 'Proyecto de Editor de Video', extensions: [PROJECT_EXT] }]
    })
    if (res.canceled || !res.filePaths[0]) return null
    const path = res.filePaths[0]
    const project = JSON.parse(await readFile(path, 'utf8')).project as Project
    // Las miniaturas viven en la carpeta temporal y pueden haberse borrado: se regeneran.
    const missing: string[] = []
    project.media = await Promise.all(
      project.media.map(async (m) => {
        if (!existsSync(m.path)) {
          missing.push(m.name)
          return { ...m, thumb: undefined }
        }
        return (await probe(m.path, m.id).catch(() => null)) ?? m
      })
    )
    return { project, path, missing }
  })

  ipcMain.handle('export:choosePath', async (e, defaultName: string) => {
    const res = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender)!, {
      title: 'Exportar video',
      defaultPath: join(app.getPath('videos'), defaultName),
      filters: [{ name: 'Video MP4', extensions: ['mp4'] }]
    })
    return res.canceled ? null : (res.filePath ?? null)
  })

  ipcMain.on('export:start', (e, req: ExportRequest) => {
    startExport(req, (ev) => {
      if (!e.sender.isDestroyed()) e.sender.send('export:event', ev)
    })
  })
  ipcMain.on('export:cancel', () => cancelExport())
  ipcMain.on('shell:showItem', (_e, path: string) => shell.showItemInFolder(path))
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
  cancelExport()
  if (process.platform !== 'darwin') app.quit()
})
