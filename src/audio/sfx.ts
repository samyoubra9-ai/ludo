import { getBus, isSfxOn, unlockAudio } from './bus'

export type Cue = 'roll' | 'land' | 'six' | 'hop' | 'capture' | 'home' | 'win' | 'lose' | 'join' | 'leave'

let rumble: { stop: () => void } | null = null

export function unlockSfx() {
  unlockAudio()
}

function env(
  ctx: AudioContext,
  dest: AudioNode,
  when: number,
  attack: number,
  hold: number,
  release: number,
  gain: number,
) {
  const amp = ctx.createGain()
  amp.gain.setValueAtTime(0.0001, when)
  amp.gain.exponentialRampToValueAtTime(gain, when + attack)
  amp.gain.setValueAtTime(gain, when + attack + hold)
  amp.gain.exponentialRampToValueAtTime(0.0001, when + attack + hold + release)
  amp.connect(dest)
  return amp
}

function osc(
  ctx: AudioContext,
  dest: AudioNode,
  type: OscillatorType,
  freq: number,
  when: number,
  dur: number,
  slide?: number,
) {
  const node = ctx.createOscillator()
  node.type = type
  node.frequency.setValueAtTime(freq, when)
  if (slide) node.frequency.exponentialRampToValueAtTime(Math.max(40, slide), when + dur)
  node.connect(dest)
  node.start(when)
  node.stop(when + dur + 0.02)
}

function noise(ctx: AudioContext, seconds: number, pink = true) {
  const size = Math.max(1, Math.floor(ctx.sampleRate * seconds))
  const buffer = ctx.createBuffer(1, size, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  let last = 0
  for (let i = 0; i < size; i += 1) {
    const white = Math.random() * 2 - 1
    last = pink ? last * 0.88 + white * 0.12 : white
    data[i] = last
  }
  const src = ctx.createBufferSource()
  src.buffer = buffer
  return src
}

/** Ludo King-style dry plastic tick. */
function diceTick(ctx: AudioContext, dest: AudioNode, when: number) {
  const src = noise(ctx, 0.018, false)
  const filter = ctx.createBiquadFilter()
  const amp = env(ctx, dest, when, 0.001, 0.003, 0.02, 0.32)
  filter.type = 'bandpass'
  filter.frequency.setValueAtTime(2400 + Math.random() * 1400, when)
  filter.Q.value = 4.5
  src.connect(filter)
  filter.connect(amp)
  src.start(when)
  const tip = env(ctx, dest, when, 0.001, 0.004, 0.018, 0.1)
  osc(ctx, tip, 'sine', 1900 + Math.random() * 700, when, 0.03)
}

function stopRumble() {
  rumble?.stop()
  rumble = null
}

function startRoll(ctx: AudioContext, dest: AudioNode) {
  stopRumble()
  const mix = ctx.createGain()
  mix.gain.value = 1
  mix.connect(dest)

  let t = ctx.currentTime + 0.01
  let gap = 0.026
  while (t < ctx.currentTime + 0.68) {
    diceTick(ctx, mix, t)
    if (Math.random() > 0.4) diceTick(ctx, mix, t + 0.006)
    gap = Math.min(0.055, gap + 0.0022)
    t += gap
  }

  rumble = {
    stop: () => {
      mix.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.03)
    },
  }
}

/** Cartoon spring on every cell — Ludo King hop. */
function kingHop(ctx: AudioContext, dest: AudioNode) {
  const when = ctx.currentTime
  const spring = env(ctx, dest, when, 0.004, 0.025, 0.1, 0.26)
  osc(ctx, spring, 'triangle', 620, when, 0.13, 240)
  const pop = env(ctx, dest, when, 0.002, 0.008, 0.04, 0.12)
  osc(ctx, pop, 'sine', 980, when, 0.05, 520)
}

/** Air blow when a pawn is sent home. */
function souffle(ctx: AudioContext, dest: AudioNode) {
  const when = ctx.currentTime
  const src = noise(ctx, 0.48, true)
  const filter = ctx.createBiquadFilter()
  const amp = env(ctx, dest, when, 0.04, 0.12, 0.32, 0.38)
  filter.type = 'bandpass'
  filter.Q.value = 0.85
  filter.frequency.setValueAtTime(2200, when)
  filter.frequency.exponentialRampToValueAtTime(180, when + 0.42)
  src.connect(filter)
  filter.connect(amp)
  src.start(when)

  const air = noise(ctx, 0.4, false)
  const high = ctx.createBiquadFilter()
  const airAmp = env(ctx, dest, when, 0.03, 0.08, 0.28, 0.16)
  high.type = 'highpass'
  high.frequency.value = 1800
  air.connect(high)
  high.connect(airAmp)
  air.start(when)

  const breath = env(ctx, dest, when, 0.03, 0.1, 0.28, 0.1)
  osc(ctx, breath, 'sine', 210, when, 0.4, 70)
}

function chime(ctx: AudioContext, dest: AudioNode, notes: number[], gap = 0.08, gain = 0.16) {
  notes.forEach((freq, i) => {
    const at = ctx.currentTime + i * gap
    const amp = env(ctx, dest, at, 0.012, 0.04, 0.32, gain)
    osc(ctx, amp, 'sine', freq, at, 0.38)
  })
}

export function playSfx(cue: Cue) {
  if (!isSfxOn()) {
    if (cue === 'land' || cue === 'win' || cue === 'lose') stopRumble()
    return
  }
  const bus = getBus()
  if (!bus) return
  unlockAudio()
  const { ctx, sfx } = bus

  if (cue === 'roll') {
    startRoll(ctx, sfx)
    return
  }

  if (cue === 'land') {
    stopRumble()
    diceTick(ctx, sfx, ctx.currentTime)
    const tok = env(ctx, sfx, ctx.currentTime, 0.002, 0.015, 0.08, 0.28)
    osc(ctx, tok, 'sine', 340, ctx.currentTime, 0.1, 150)
    const table = env(ctx, sfx, ctx.currentTime, 0.002, 0.02, 0.1, 0.16)
    osc(ctx, table, 'sine', 110, ctx.currentTime, 0.14, 70)
    return
  }

  if (cue === 'hop') {
    kingHop(ctx, sfx)
    return
  }

  if (cue === 'six') {
    chime(ctx, sfx, [659, 784, 988], 0.07, 0.15)
    return
  }

  if (cue === 'capture') {
    souffle(ctx, sfx)
    return
  }

  if (cue === 'home') {
    chime(ctx, sfx, [523, 659], 0.09, 0.14)
    return
  }

  if (cue === 'win') {
    chime(ctx, sfx, [523, 659, 784, 988], 0.11, 0.17)
    return
  }

  if (cue === 'join') {
    chime(ctx, sfx, [659, 880], 0.06, 0.12)
    return
  }

  if (cue === 'leave') {
    const when = ctx.currentTime
    const down = env(ctx, sfx, when, 0.01, 0.04, 0.16, 0.12)
    osc(ctx, down, 'sine', 330, when, 0.2, 180)
    return
  }

  stopRumble()
  const when = ctx.currentTime
  const down = env(ctx, sfx, when, 0.02, 0.08, 0.3, 0.2)
  osc(ctx, down, 'sine', 196, when, 0.4, 98)
}
