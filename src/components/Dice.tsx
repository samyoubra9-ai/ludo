import { useEffect, useRef, useState } from 'react'

const PIPS: Record<number, number[]> = {
  1: [5],
  2: [1, 9],
  3: [1, 5, 9],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9],
}

const FACES = [1, 2, 3, 4, 5, 6] as const
const SPIN_MS = 720
const LAND_MS = 320

function Pips({ value }: { value: number }) {
  const pips = PIPS[value] ?? PIPS[1]
  return (
    <div className="dice__face">
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={pips.includes(i + 1) ? 'pip is-on' : 'pip'} />
      ))}
    </div>
  )
}

function easeOut(t: number) {
  return 1 - (1 - t) ** 3
}

export function Dice({
  value,
  rolling,
}: {
  value: number
  rolling: boolean
}) {
  const cubeRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef(0)
  const landTimer = useRef(0)
  const [shown, setShown] = useState(value)
  const [phase, setPhase] = useState<'idle' | 'spin' | 'land'>('idle')

  useEffect(() => {
    window.cancelAnimationFrame(rafRef.current)
    window.clearTimeout(landTimer.current)

    if (rolling) {
      setPhase('spin')
      const start = performance.now()
      const turnX = 360 * (2.8 + Math.random() * 1.6)
      const turnY = 360 * (3.4 + Math.random() * 1.8)
      const turnZ = 360 * (0.9 + Math.random() * 1.2)
      const lift = 12 + Math.random() * 6

      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / SPIN_MS)
        const e = easeOut(t)
        const wobble = Math.sin(t * Math.PI * 6) * 14 * (1 - t)
        const node = cubeRef.current
        if (node) {
          const rise = -Math.sin(t * Math.PI) * lift
          const zoom = 0.94 + Math.sin(t * Math.PI) * 0.1
          node.style.transform = `translateY(${rise}px) rotateX(${turnX * e + wobble}deg) rotateY(${turnY * e}deg) rotateZ(${turnZ * e - wobble * 0.55}deg) scale(${zoom})`
        }
        if (t < 1) rafRef.current = window.requestAnimationFrame(tick)
      }
      rafRef.current = window.requestAnimationFrame(tick)
      return () => window.cancelAnimationFrame(rafRef.current)
    }

    setShown(value)
    setPhase((current) => (current === 'spin' ? 'land' : 'idle'))
    landTimer.current = window.setTimeout(() => setPhase('idle'), LAND_MS)
    return () => window.clearTimeout(landTimer.current)
  }, [rolling, value])

  const cubeUp = rolling || phase === 'spin' || phase === 'land'

  return (
    <div
      className={`dice ${rolling || phase === 'spin' ? 'is-spin' : ''} ${!rolling && phase === 'land' ? 'is-land' : ''}`}
      aria-label={rolling ? 'Le dé tourne' : `Dé : ${shown}`}
    >
      <div className="dice-flat">
        <Pips value={shown} />
      </div>
      {cubeUp ? (
        <div ref={cubeRef} className="dice-cube">
          {FACES.map((n) => (
            <div key={n} className={`dice-side dice-side--${n}`}>
              <Pips value={n} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
