import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { ExportEvent, ExportVideoDone, MediaItem, Project, Word } from '../shared/types'

type Off = () => void
function on<A extends unknown[]>(channel: string, cb: (...args: A) => void): Off {
  const listener = (_: unknown, ...args: unknown[]) => cb(...(args as A))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

export interface Settings {
  claudePath: string | null
  model: string
  whisperModel: 'base' | 'small' | 'turbo'
  language: string
  brand: Project['brand']
}

export interface ConfirmOptions {
  message: string
  detail?: string
  confirm: string
  cancel?: string
  destructive?: boolean
}

export type CtxItem =
  | { id: string; label: string; enabled?: boolean; checked?: boolean; accelerator?: string }
  | { type: 'separator' }

export type AiProgress = { kind: 'status'; text: string }
export type TranscribeProgress = { stage: 'audio' | 'download' | 'working'; ratio?: number }
export interface AiResult {
  reply: string
  operations: { op: string; [k: string]: unknown }[]
  sessionId: string | null
  costUsd: number
}

const api = {
  platform: process.platform,
  pathForFile: (file: File): string => webUtils.getPathForFile(file),

  pickMedia: (): Promise<MediaItem[]> => ipcRenderer.invoke('media:pick'),
  probePaths: (paths: string[]): Promise<MediaItem[]> => ipcRenderer.invoke('media:probe', paths),
  needsProxy: (m: MediaItem): Promise<boolean> => ipcRenderer.invoke('media:needsProxy', m),
  makeProxy: (m: MediaItem): Promise<string> => ipcRenderer.invoke('media:makeProxy', m),
  onProxyProgress: (cb: (mediaId: string, ratio: number) => void): Off => on('media:proxyProgress', cb),

  saveProject: (project: Project, currentPath: string | null, saveAs: boolean): Promise<string | null> =>
    ipcRenderer.invoke('project:save', project, currentPath, saveAs),
  openProject: (): Promise<{ project: Project; path: string; missing: string[] } | null> => ipcRenderer.invoke('project:open'),
  setDirty: (dirty: boolean): void => ipcRenderer.send('project:dirty', dirty),
  setRepresentedFile: (path: string | null): void => ipcRenderer.send('project:file', path),
  confirm: (opts: ConfirmOptions): Promise<boolean> => ipcRenderer.invoke('dialog:confirm', opts),
  contextMenu: (items: CtxItem[]): Promise<string | null> => ipcRenderer.invoke('menu:context', items),

  chooseExportPath: (defaultName: string): Promise<string | null> => ipcRenderer.invoke('export:choosePath', defaultName),
  exportBegin: (webm: boolean): Promise<string> => ipcRenderer.invoke('export:begin', webm),
  exportChunk: (position: number, data: Uint8Array): Promise<void> => ipcRenderer.invoke('export:chunk', position, data),
  exportFinish: (req: ExportVideoDone): void => ipcRenderer.send('export:finish', req),
  exportAbort: (): void => ipcRenderer.send('export:abort'),
  onExportEvent: (cb: (e: ExportEvent) => void): Off => on('export:event', cb),
  showInFolder: (path: string): void => ipcRenderer.send('shell:showItem', path),

  getSettings: (): Promise<{ settings: Settings; whisperModels: Record<string, { repo: string; label: string }> }> =>
    ipcRenderer.invoke('settings:get'),
  setSettings: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke('settings:set', patch),

  aiStatus: (): Promise<{ found: boolean; path: string | null; version: string | null }> => ipcRenderer.invoke('ai:status'),
  aiLogin: (): void => ipcRenderer.send('ai:login'),
  aiRun: (req: { conversationId: string; sessionId: string | null; project: Project; message: string }): Promise<AiResult> =>
    ipcRenderer.invoke('ai:run', req),
  aiCancel: (conversationId: string): void => ipcRenderer.send('ai:cancel', conversationId),
  onAiProgress: (cb: (conversationId: string, p: AiProgress) => void): Off => on('ai:progress', cb),
  transcribe: (m: MediaItem): Promise<Word[]> => ipcRenderer.invoke('ai:transcribe', m),
  onTranscribeProgress: (cb: (mediaId: string, p: TranscribeProgress) => void): Off => on('ai:transcribeProgress', cb),

  accentColor: (): Promise<string | null> => ipcRenderer.invoke('system:accent'),
  onFullscreen: (cb: (on: boolean) => void): Off => on('window:fullscreen', cb),

  onMenu: (cb: (cmd: string) => void): Off => on('menu', cb)
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
