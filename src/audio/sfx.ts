import { getBus, isSfxOn, unlockAudio } from './bus'

export type Cue = 'roll' | 'land' | 'six' | 'hop' | 'capture' | 'home' | 'win' | 'lose' | 'join' | 'leave'

export function unlockSfx() {
  unlockAudio()
}

function jitter(n: number, amt = 0.1) {
  return n * (1 + (Math.random() * 2 - 1) * amt)
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
  amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), when + attack)
  amp.gain.setValueAtTime(Math.max(0.0002, gain), when + attack + hold)
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

function burst(
  ctx: AudioContext,
  dest: AudioNode,
  when: number,
  seconds: number,
  pink: boolean,
  type: BiquadFilterType,
  freq: number,
  q: number,
  gain: number,
  attack = 0.001,
  hold = 0.008,
  release = 0.04,
  sweep?: number,
) {
  const src = noise(ctx, seconds, pink)
  const filter = ctx.createBiquadFilter()
  const amp = env(ctx, dest, when, attack, hold, release, gain)
  filter.type = type
  filter.Q.value = q
  filter.frequency.setValueAtTime(freq, when)
  if (sweep) filter.frequency.exponentialRampToValueAtTime(sweep, when + attack + hold + release)
  src.connect(filter)
  filter.connect(amp)
  src.start(when)
}

function tableThump(ctx: AudioContext, dest: AudioNode, when: number, gain: number) {
  const body = env(ctx, dest, when, 0.001, 0.012, 0.07, gain)
  osc(ctx, body, 'sine', jitter(108, 0.12), when, 0.09, 58)
  const wood = env(ctx, dest, when, 0.001, 0.008, 0.05, gain * 0.45)
  osc(ctx, wood, 'sine', jitter(52, 0.08), when, 0.07, 32)
}

function cardSnap(ctx: AudioContext, dest: AudioNode, when: number, gain = 0.3) {
  burst(ctx, dest, when, 0.03, false, 'highpass', jitter(2400, 0.15), 0.7, gain * 0.55, 0.0006, 0.004, 0.02)
  burst(ctx, dest, when, 0.055, true, 'bandpass', jitter(1350, 0.12), 0.95, gain * 0.32, 0.001, 0.01, 0.038)
  tableThump(ctx, dest, when + 0.003, gain * 0.42)
}

function cardDeal(ctx: AudioContext, dest: AudioNode, when: number) {
  burst(ctx, dest, when, 0.09, true, 'bandpass', jitter(900, 0.1), 0.8, 0.1, 0.008, 0.03, 0.05, jitter(2200, 0.12))
  cardSnap(ctx, dest, when + 0.05, 0.26)
}

function cardSlide(ctx: AudioContext, dest: AudioNode, when: number) {
  burst(ctx, dest, when, 0.16, true, 'lowpass', jitter(700, 0.12), 0.6, 0.1, 0.012, 0.06, 0.08, jitter(1600, 0.1))
  burst(ctx, dest, when + 0.02, 0.1, false, 'bandpass', jitter(2100, 0.1), 1.1, 0.045, 0.004, 0.03, 0.06)
}

function cardFlip(ctx: AudioContext, dest: AudioNode, when: number) {
  burst(ctx, dest, when, 0.11, true, 'highpass', jitter(480, 0.1), 0.55, 0.11, 0.006, 0.04, 0.07, jitter(2400, 0.12))
  cardSnap(ctx, dest, when + 0.09, 0.34)
}

function riffle(ctx: AudioContext, dest: AudioNode, when: number) {
  let t = when
  let gap = 0.028
  for (let i = 0; i < 11; i += 1) {
    cardSnap(ctx, dest, t, 0.09 + Math.random() * 0.05)
    t += gap
    gap = Math.min(0.048, gap + 0.0018)
  }
}

function chips(ctx: AudioContext, dest: AudioNode, when: number) {
  ;[0, 0.032, 0.07].forEach((off, i) => {
    const t = when + off
    const tone = jitter(2400 - i * 220, 0.08)
    burst(ctx, dest, t, 0.02, false, 'bandpass', tone, 3.2, 0.16, 0.0008, 0.004, 0.018)
    const ping = env(ctx, dest, t, 0.001, 0.006, 0.03, 0.07)
    osc(ctx, ping, 'sine', tone * 0.72, t, 0.04, tone * 0.4)
  })
}

function eat(ctx: AudioContext, dest: AudioNode, when: number) {
  cardSnap(ctx, dest, when, 0.38)
  tableThump(ctx, dest, when + 0.008, 0.28)
  burst(ctx, dest, when + 0.01, 0.12, true, 'lowpass', 420, 0.7, 0.12, 0.004, 0.03, 0.09, 140)
}

function tone(ctx: AudioContext, dest: AudioNode, midi: number, when: number, dur: number, gain: number) {
  const freq = 440 * 2 ** ((midi - 69) / 12)
  const filter = ctx.createBiquadFilter()
  const amp = env(ctx, dest, when, 0.01, dur * 0.35, dur * 0.65, gain)
  filter.type = 'lowpass'
  filter.frequency.setValueAtTime(980, when)
  filter.Q.value = 0.8
  filter.connect(amp)
  osc(ctx, filter, 'sine', freq, when, dur)
  osc(ctx, filter, 'sine', freq * 2.01, when, dur * 0.45)
}

function chef(ctx: AudioContext, dest: AudioNode, when: number) {
  tone(ctx, dest, 67, when, 0.42, 0.09)
  tone(ctx, dest, 74, when + 0.09, 0.48, 0.07)
}

function recap(ctx: AudioContext, dest: AudioNode, when: number) {
  tone(ctx, dest, 60, when, 0.55, 0.08)
  tone(ctx, dest, 64, when + 0.12, 0.6, 0.07)
  tone(ctx, dest, 67, when + 0.26, 0.72, 0.06)
}

function leave(ctx: AudioContext, dest: AudioNode, when: number) {
  const down = env(ctx, dest, when, 0.01, 0.05, 0.18, 0.1)
  osc(ctx, down, 'sine', 196, when, 0.24, 98)
}

export function playSfx(cue: Cue, delayMs = 0) {
  if (!isSfxOn()) return
  const bus = getBus()
  if (!bus) return
  unlockAudio()
  const { ctx, sfx } = bus
  const when = ctx.currentTime + Math.max(0, delayMs) / 1000

  if (cue === 'roll') {
    riffle(ctx, sfx, when)
    return
  }
  if (cue === 'join') {
    cardDeal(ctx, sfx, when)
    return
  }
  if (cue === 'hop') {
    cardSlide(ctx, sfx, when)
    return
  }
  if (cue === 'land') {
    cardFlip(ctx, sfx, when)
    return
  }
  if (cue === 'home') {
    chips(ctx, sfx, when)
    return
  }
  if (cue === 'capture') {
    eat(ctx, sfx, when)
    return
  }
  if (cue === 'six') {
    chef(ctx, sfx, when)
    return
  }
  if (cue === 'win') {
    recap(ctx, sfx, when)
    return
  }
  if (cue === 'leave' || cue === 'lose') {
    leave(ctx, sfx, when)
    return
  }
}
