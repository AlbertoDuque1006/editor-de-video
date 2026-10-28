import { join } from 'node:path'
import { utilityProcess, type UtilityProcess } from 'electron'
import type { MediaItem, Word } from '../shared/types'
import { dataDir } from './env'
import { decodeAudio16k } from './media'

export const WHISPER_MODELS = {
  base: { repo: 'onnx-community/whisper-base_timestamped', label: 'Rápido (base, ~150 MB)' },
  small: { repo: 'onnx-community/whisper-small_timestamped', label: 'Equilibrado (small, ~400 MB)' },
  turbo: { repo: 'onnx-community/whisper-large-v3-turbo_timestamped', label: 'Máxima calidad (turbo, ~1 GB)' }
} as const
export type WhisperModel = keyof typeof WHISPER_MODELS

export type TranscribeProgress = { stage: 'audio' | 'download' | 'working'; ratio?: number }

let worker: UtilityProcess | null = null
let nextId = 1
const pending = new Map<number, { resolve: (w: Word[]) => void; reject: (e: Error) => void; progress: (p: TranscribeProgress) => void }>()

function getWorker(): UtilityProcess {
  if (worker) return worker
  const w = utilityProcess.fork(join(__dirname, 'transcriber.js'), [], { serviceName: 'Transcripción' })
  w.on('message', (msg: { id: number; type: string; ratio?: number; words?: Word[]; message?: string }) => {
    const job = pending.get(msg.id)
    if (!job) return
    if (msg.type === 'download') job.progress({ stage: 'download', ratio: msg.ratio })
    else if (msg.type === 'working') job.progress({ stage: 'working' })
    else if (msg.type === 'done') {
      pending.delete(msg.id)
      job.resolve(msg.words ?? [])
    } else if (msg.type === 'error') {
      pending.delete(msg.id)
      job.reject(new Error(`No se pudo transcribir: ${msg.message}`))
    }
  })
  w.on('exit', () => {
    worker = null
    for (const [id, job] of pending) {
      job.reject(new Error('El proceso de transcripción se cerró.'))
      pending.delete(id)
    }
  })
  worker = w
  return w
}

/** Fracción de tramos de 30 ms con sonido audible (más de -45 dB). */
function soundRatio(audio: Float32Array): number {
  const frame = 480
  let loud = 0
  let frames = 0
  for (let i = 0; i + frame <= audio.length; i += frame, frames++) {
    let sum = 0
    for (let j = i; j < i + frame; j++) sum += audio[j] * audio[j]
    if (Math.sqrt(sum / frame) > 0.0056) loud++
  }
  return frames ? loud / frames : 0
}

/** Transcribe el audio de un archivo con tiempos por palabra (en segundos del archivo). */
export async function transcribe(m: MediaItem, model: WhisperModel, language: string, progress: (p: TranscribeProgress) => void): Promise<Word[]> {
  progress({ stage: 'audio' })
  const audio = await decodeAudio16k(m.path)
  // Con audio casi mudo Whisper se inventa frases; mejor no transcribir.
  if (audio.length < 1600 || soundRatio(audio) < 0.03) return []
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, progress })
    getWorker().postMessage({ id, model: WHISPER_MODELS[model].repo, cacheDir: dataDir('modelos'), language, audio })
  })
}

export function stopTranscriber(): void {
  worker?.kill()
  worker = null
}
