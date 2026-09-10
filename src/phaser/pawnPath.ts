import { STRETCH_MAX, TRACK_MAX } from '../ludo/path'
import type { TokenLoc } from '../ludo/types'

export function copyLoc(loc: TokenLoc): TokenLoc {
  switch (loc.kind) {
    case 'yard':
      return { kind: 'yard', slot: loc.slot }
    case 'track':
      return { kind: 'track', steps: loc.steps }
    case 'stretch':
      return { kind: 'stretch', steps: loc.steps }
    case 'done':
      return { kind: 'done' }
  }
}

export function sameLoc(a: TokenLoc, b: TokenLoc) {
  if (a.kind !== b.kind) return false
  if (a.kind === 'done' || b.kind === 'done') return true
  if (a.kind === 'yard' && b.kind === 'yard') return a.slot === b.slot
  if (a.kind === 'track' && b.kind === 'track') return a.steps === b.steps
  if (a.kind === 'stretch' && b.kind === 'stretch') return a.steps === b.steps
  return false
}

function trackRange(fromStep: number, toStep: number): TokenLoc[] {
  const out: TokenLoc[] = []
  for (let step = fromStep + 1; step <= toStep; step += 1) {
    out.push({ kind: 'track', steps: step })
  }
  return out
}

function stretchRange(fromStep: number, toStep: number): TokenLoc[] {
  const out: TokenLoc[] = []
  for (let step = fromStep + 1; step <= toStep; step += 1) {
    out.push({ kind: 'stretch', steps: step })
  }
  return out
}

export function forwardLocs(from: TokenLoc, to: TokenLoc): TokenLoc[] {
  if (sameLoc(from, to)) return []

  if (from.kind === 'yard') {
    if (to.kind === 'track') return trackRange(-1, to.steps)
    if (to.kind === 'stretch') {
      return [...trackRange(-1, TRACK_MAX), ...stretchRange(-1, to.steps)]
    }
    if (to.kind === 'done') {
      return [...trackRange(-1, TRACK_MAX), ...stretchRange(-1, STRETCH_MAX), { kind: 'done' }]
    }
    return [to]
  }

  if (from.kind === 'track') {
    if (to.kind === 'track') return trackRange(from.steps, to.steps)
    if (to.kind === 'stretch') {
      return [...trackRange(from.steps, TRACK_MAX), ...stretchRange(-1, to.steps)]
    }
    if (to.kind === 'done') {
      return [...trackRange(from.steps, TRACK_MAX), ...stretchRange(-1, STRETCH_MAX), { kind: 'done' }]
    }
  }

  if (from.kind === 'stretch') {
    if (to.kind === 'stretch') return stretchRange(from.steps, to.steps)
    if (to.kind === 'done') return [...stretchRange(from.steps, STRETCH_MAX), { kind: 'done' }]
  }

  return [to]
}

export function homeLocs(from: TokenLoc, slot: number): TokenLoc[] {
  const out: TokenLoc[] = []
  if (from.kind === 'done') {
    for (let step = STRETCH_MAX; step >= 0; step -= 1) out.push({ kind: 'stretch', steps: step })
    for (let step = TRACK_MAX; step >= 0; step -= 1) out.push({ kind: 'track', steps: step })
  } else if (from.kind === 'stretch') {
    for (let step = from.steps - 1; step >= 0; step -= 1) out.push({ kind: 'stretch', steps: step })
    for (let step = TRACK_MAX; step >= 0; step -= 1) out.push({ kind: 'track', steps: step })
  } else if (from.kind === 'track') {
    for (let step = from.steps - 1; step >= 0; step -= 1) out.push({ kind: 'track', steps: step })
  }
  out.push({ kind: 'yard', slot })
  return out
}
