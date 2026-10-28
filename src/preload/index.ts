import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { ExportEvent, ExportRequest, MediaItem, Project } from '../shared/types'

const api = {
  pickMedia: (): Promise<MediaItem[]> => ipcRenderer.invoke('media:pick'),
  probePaths: (paths: string[]): Promise<MediaItem[]> => ipcRenderer.invoke('media:probe', paths),
  pathForFile: (file: File): string => webUtils.getPathForFile(file),
  saveProject: (project: Project, currentPath: string | null, saveAs: boolean): Promise<string | null> =>
    ipcRenderer.invoke('project:save', project, currentPath, saveAs),
  openProject: (): Promise<{ project: Project; path: string; missing: string[] } | null> =>
    ipcRenderer.invoke('project:open'),
  chooseExportPath: (defaultName: string): Promise<string | null> =>
    ipcRenderer.invoke('export:choosePath', defaultName),
  startExport: (req: ExportRequest): void => ipcRenderer.send('export:start', req),
  cancelExport: (): void => ipcRenderer.send('export:cancel'),
  onExportEvent: (cb: (e: ExportEvent) => void): (() => void) => {
    const listener = (_: unknown, ev: ExportEvent) => cb(ev)
    ipcRenderer.on('export:event', listener)
    return () => ipcRenderer.removeListener('export:event', listener)
  },
  showInFolder: (path: string): void => ipcRenderer.send('shell:showItem', path),
  onMenu: (cb: (cmd: string) => void): (() => void) => {
    const listener = (_: unknown, cmd: string) => cb(cmd)
    ipcRenderer.on('menu', listener)
    return () => ipcRenderer.removeListener('menu', listener)
  },
  platform: process.platform
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
