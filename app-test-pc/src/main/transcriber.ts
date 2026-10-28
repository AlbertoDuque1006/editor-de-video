// Proceso aparte (utilityProcess) para Whisper: transcribir ocupa la CPU varios segundos y no debe congelar la app.
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'

interface Request {
  id: number
  model: string
  cacheDir: string
  language: string
  audio: Float32Array
}

type Chunk = { text: string; timestamp: [number, number | null] }

const port = process.parentPort
const loaded = new Map<string, Promise<AutomaticSpeechRecognitionPipeline>>()

function load(model: string, cacheDir: string, id: number): Promise<AutomaticSpeechRecognitionPipeline> {
  let p = loaded.get(model)
  if (!p) {
    env.cacheDir = cacheDir
    env.allowLocalModels = false
    const files = new Map<string, { loaded: number; total: number }>()
    p = pipeline('automatic-speech-recognition', model, {
      dtype: { encoder_model: 'fp32', decoder_model_merged: 'q8' },
      device: 'cpu',
      progress_callback: (e: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (e.status !== 'progress' || !e.file) return
        files.set(e.file, { loaded: e.loaded ?? 0, total: e.total ?? 0 })
        const all = [...files.values()]
        const total = all.reduce((s, f) => s + f.total, 0)
        if (total > 0) port.postMessage({ id, type: 'download', ratio: all.reduce((s, f) => s + f.loaded, 0) / total })
      }
    }) as Promise<AutomaticSpeechRecognitionPipeline>
    p.catch(() => loaded.delete(model))
    loaded.set(model, p)
  }
  return p
}

port.on('message', async ({ data }: { data: Request }) => {
  const { id } = data
  try {
    const asr = await load(data.model, data.cacheDir, id)
    port.postMessage({ id, type: 'working' })
    const out = (await asr(data.audio, {
      language: data.language,
      task: 'transcribe',
      return_timestamps: 'word',
      chunk_length_s: 30,
      stride_length_s: 5
    })) as { text: string; chunks?: Chunk[] }
    const words = (out.chunks ?? [])
      .map((c) => ({ text: c.text.trim(), start: c.timestamp[0], end: c.timestamp[1] ?? c.timestamp[0] + 0.3 }))
      .filter((w) => w.text)
    port.postMessage({ id, type: 'done', words })
  } catch (err) {
    port.postMessage({ id, type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
})
