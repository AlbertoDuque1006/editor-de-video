import type { Word } from './types.ts'

export interface CutOptions { minGap: number; pad: number; fillers: boolean }
export const DEFAULT_CUTS: CutOptions = { minGap: 0.6, pad: 0.12, fillers: true }

export function isFiller(word: string): boolean {
  return /^(e+h*|e+m+|m+|a+h+|h+m+|ehm+)$/.test(word.toLowerCase().replace(/[^a-z]/g, ''))
}

export function planKeep(words: Word[], from: number, to: number, opts: Partial<CutOptions> = {}): { start: number; end: number }[] {
  const { minGap, pad, fillers } = { ...DEFAULT_CUTS, ...opts }
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return []
  const spans = words
    .filter(w => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > from && w.start < to && w.end > w.start && (!fillers || !isFiller(w.text)))
    .map(w => ({ start: Math.max(from, w.start - Math.max(0, pad)), end: Math.min(to, w.end + Math.max(0, pad)) }))
    .sort((a, b) => a.start - b.start)
  const result: { start: number; end: number }[] = []
  for (const span of spans) {
    const last = result.at(-1)
    if (last && (span.start <= last.end || span.start - last.end < Math.max(0, minGap))) last.end = Math.max(last.end, span.end)
    else result.push({ ...span })
  }
  return result.filter(s => s.end - s.start >= 0.1 - 1e-9)
}
