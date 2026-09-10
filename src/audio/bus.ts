type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext }

const MUSIC_KEY = 'ludo-music-on'
const SFX_KEY = 'ludo-sfx-on'
const EVENT = 'ludo-audio'

let ctx: AudioContext | null = null
let master: GainNode | null = null
let sfx: GainNode | null = null
let music: GainNode | null = null

function read(key: string, fallback = true) {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    return raw !== '0'
  } catch {
    return fallback
  }
}

function write(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? '1' : '0')
  } catch {
    /* ignore */
  }
}

function ramp(node: GainNode, value: number, ms = 90) {
  if (!ctx) return
  node.gain.cancelScheduledValues(ctx.currentTime)
  node.gain.setValueAtTime(Math.max(0.0001, node.gain.value), ctx.currentTime)
  node.gain.linearRampToValueAtTime(value, ctx.currentTime + ms / 1000)
}

export function getBus() {
  if (ctx && master && sfx && music) return { ctx, master, sfx, music }
  const Ctor = window.AudioContext || (window as WebkitWindow).webkitAudioContext
  if (!Ctor) return null
  ctx = new Ctor()
  master = ctx.createGain()
  sfx = ctx.createGain()
  music = ctx.createGain()
  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = -16
  comp.knee.value = 18
  comp.ratio.value = 2.4
  comp.attack.value = 0.004
  comp.release.value = 0.16
  master.gain.value = 1
  sfx.gain.value = read(SFX_KEY) ? 0.88 : 0.0001
  music.gain.value = read(MUSIC_KEY) ? 0.3 : 0.0001
  sfx.connect(comp)
  music.connect(comp)
  comp.connect(master)
  master.connect(ctx.destination)
  return { ctx, master, sfx, music }
}

export function unlockAudio() {
  const bus = getBus()
  if (!bus) return
  if (bus.ctx.state === 'suspended') void bus.ctx.resume()
}

export function isMusicOn() {
  return read(MUSIC_KEY)
}

export function isSfxOn() {
  return read(SFX_KEY)
}

export function setMusicOn(on: boolean) {
  write(MUSIC_KEY, on)
  const bus = getBus()
  if (bus) ramp(bus.music, on ? 0.3 : 0.0001, 160)
  if (on) unlockAudio()
  window.dispatchEvent(new Event(EVENT))
}

export function setSfxOn(on: boolean) {
  write(SFX_KEY, on)
  const bus = getBus()
  if (bus) ramp(bus.sfx, on ? 0.88 : 0.0001, 80)
  if (on) unlockAudio()
  window.dispatchEvent(new Event(EVENT))
}

export function applyMusicLevel(level: number) {
  const bus = getBus()
  if (!bus || !isMusicOn()) return
  ramp(bus.music, level, 220)
}

export function resumeIfVisible() {
  const bus = getBus()
  if (!bus) return
  if (document.hidden) {
    if (bus.ctx.state === 'running') void bus.ctx.suspend()
    return
  }
  if ((isMusicOn() || isSfxOn()) && bus.ctx.state === 'suspended') void bus.ctx.resume()
}

export const AUDIO_EVENT = EVENT
