import { applyMusicLevel, getBus, isMusicOn, unlockAudio } from './bus'

export type Track = 'lobby' | 'play' | 'off'
export const THEME = 'kalimba-dusk'

const LOBBY_STEP = 60 / 78 / 2
const PLAY_STEP = 60 / 68 / 2

/** F – C – Dm – Bb */
const LOBBY_CHORDS = [
  [53, 57, 60, 65],
  [48, 52, 55, 60],
  [50, 53, 57, 62],
  [46, 50, 53, 58],
] as const

/** Dm – F – C – Am */
const PLAY_CHORDS = [
  [50, 53, 57, 60],
  [53, 57, 60, 65],
  [48, 52, 55, 60],
  [45, 48, 52, 57],
] as const

const LOBBY_TINE = [
  72, 0, 69, 72, 77, 0, 74, 72, 69, 0, 65, 69, 72, 74, 0, 69, 72, 0, 69, 65, 69, 0, 72, 77, 74, 0, 72, 69, 65, 67, 0, 65,
]
const PLAY_TINE = [
  69, 0, 0, 65, 69, 0, 72, 0, 70, 0, 69, 0, 65, 62, 0, 60, 65, 0, 0, 62, 65, 0, 69, 0, 67, 0, 65, 0, 60, 57, 0, 53,
]

let track: Track = 'off'
let timer = 0
let nextTime = 0
let step = 0

function hz(midi: number) {
  return 440 * 2 ** ((midi - 69) / 12)
}

function kalimba(ctx: AudioContext, dest: AudioNode, midi: number, when: number, gain: number) {
  const freq = hz(midi)
  const out = ctx.createGain()
  out.gain.setValueAtTime(0.0001, when)
  out.gain.exponentialRampToValueAtTime(gain, when + 0.008)
  out.gain.exponentialRampToValueAtTime(gain * 0.35, when + 0.12)
  out.gain.exponentialRampToValueAtTime(0.0001, when + 0.9)
  out.connect(dest)

  const carrier = ctx.createOscillator()
  const mod = ctx.createOscillator()
  const modAmp = ctx.createGain()
  carrier.type = 'sine'
  mod.type = 'sine'
  carrier.frequency.setValueAtTime(freq, when)
  mod.frequency.setValueAtTime(freq * 2.01, when)
  modAmp.gain.setValueAtTime(freq * 0.55, when)
  modAmp.gain.exponentialRampToValueAtTime(freq * 0.08, when + 0.22)
  mod.connect(modAmp)
  modAmp.connect(carrier.frequency)
  carrier.connect(out)
  carrier.start(when)
  mod.start(when)
  carrier.stop(when + 0.95)
  mod.stop(when + 0.95)

  const tine = ctx.createOscillator()
  const tineAmp = ctx.createGain()
  tine.type = 'sine'
  tine.frequency.setValueAtTime(freq * 4.08, when)
  tineAmp.gain.setValueAtTime(0.0001, when)
  tineAmp.gain.exponentialRampToValueAtTime(gain * 0.18, when + 0.004)
  tineAmp.gain.exponentialRampToValueAtTime(0.0001, when + 0.11)
  tine.connect(tineAmp)
  tineAmp.connect(dest)
  tine.start(when)
  tine.stop(when + 0.14)
}

function rhodes(ctx: AudioContext, dest: AudioNode, midi: number, when: number, dur: number, gain: number) {
  const freq = hz(midi)
  const filter = ctx.createBiquadFilter()
  const amp = ctx.createGain()
  filter.type = 'lowpass'
  filter.frequency.setValueAtTime(720, when)
  filter.Q.value = 0.7
  amp.gain.setValueAtTime(0.0001, when)
  amp.gain.linearRampToValueAtTime(gain, when + 0.11)
  amp.gain.linearRampToValueAtTime(gain * 0.7, when + dur * 0.7)
  amp.gain.linearRampToValueAtTime(0.0001, when + dur)
  filter.connect(amp)
  amp.connect(dest)

  for (const [ratio, mix] of [
    [1, 1],
    [2, 0.16],
    [0.5, 0.22],
  ] as const) {
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(freq * ratio, when)
    g.gain.value = mix
    osc.connect(g)
    g.connect(filter)
    osc.start(when)
    osc.stop(when + dur + 0.03)
  }
}

function bass(ctx: AudioContext, dest: AudioNode, midi: number, when: number, dur: number) {
  const osc = ctx.createOscillator()
  const amp = ctx.createGain()
  const filter = ctx.createBiquadFilter()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(hz(midi), when)
  filter.type = 'lowpass'
  filter.frequency.value = 280
  amp.gain.setValueAtTime(0.0001, when)
  amp.gain.linearRampToValueAtTime(0.11, when + 0.05)
  amp.gain.linearRampToValueAtTime(0.0001, when + dur)
  osc.connect(filter)
  filter.connect(amp)
  amp.connect(dest)
  osc.start(when)
  osc.stop(when + dur + 0.02)
}

function shaker(ctx: AudioContext, dest: AudioNode, when: number) {
  const size = Math.floor(ctx.sampleRate * 0.05)
  const buffer = ctx.createBuffer(1, size, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < size; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / size)
  const src = ctx.createBufferSource()
  const filter = ctx.createBiquadFilter()
  const amp = ctx.createGain()
  src.buffer = buffer
  filter.type = 'bandpass'
  filter.frequency.value = 3200
  filter.Q.value = 0.8
  amp.gain.setValueAtTime(0.03, when)
  amp.gain.exponentialRampToValueAtTime(0.0001, when + 0.05)
  src.connect(filter)
  filter.connect(amp)
  amp.connect(dest)
  src.start(when)
}

function schedule(kind: Exclude<Track, 'off'>, beat: number, when: number) {
  const bus = getBus()
  if (!bus) return
  const { ctx, music } = bus
  const chords = kind === 'lobby' ? LOBBY_CHORDS : PLAY_CHORDS
  const chord = chords[Math.floor(beat / 8) % chords.length]
  const tine = kind === 'lobby' ? LOBBY_TINE[beat] : PLAY_TINE[beat]
  const step = kind === 'lobby' ? LOBBY_STEP : PLAY_STEP

  if (beat % 8 === 0) {
    bass(ctx, music, chord[0] - 12, when, step * 7.2)
    for (const note of chord) rhodes(ctx, music, note, when, step * 7.6, kind === 'play' ? 0.034 : 0.026)
  }
  if (kind === 'lobby' && (beat % 4 === 2 || beat % 8 === 6)) shaker(ctx, music, when)
  if (tine) kalimba(ctx, music, tine, when, kind === 'lobby' ? 0.13 : 0.09)
}

function tick() {
  const bus = getBus()
  if (!bus || track === 'off') return
  const stepLen = track === 'play' ? PLAY_STEP : LOBBY_STEP
  while (nextTime < bus.ctx.currentTime + 0.22) {
    schedule(track, step, nextTime)
    nextTime += stepLen
    step = (step + 1) % 32
  }
  timer = window.setTimeout(tick, 50)
}

function stopClock() {
  window.clearTimeout(timer)
  timer = 0
}

export function setMusic(next: Track) {
  const bus = getBus()
  const same = next === track && timer
  track = next
  if (!bus) return
  if (same) return

  if (next === 'off') {
    applyMusicLevel(0.0001)
    stopClock()
    return
  }

  unlockAudio()
  if (isMusicOn()) applyMusicLevel(0.28)
  stopClock()
  nextTime = bus.ctx.currentTime + 0.05
  step = 0
  tick()
}

export function currentTrack() {
  return track
}
