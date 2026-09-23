import { useEffect, useRef, useState } from 'react'
import Phaser from 'phaser'
import { PaquetScene, type PaquetView } from '../phaser/PaquetScene'
import type { PaquetColor, PaquetState } from '../paquet/engine'

export function PaquetBoard({
  state,
  you,
  selectable,
  onPick,
}: {
  state: PaquetState
  you: PaquetColor
  selectable: number[]
  onPick: (id: number) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const gameRef = useRef<Phaser.Game | null>(null)
  const sceneRef = useRef<PaquetScene | null>(null)
  const onPickRef = useRef(onPick)
  const viewRef = useRef<PaquetView>({ state, you, selectable })
  const [ready, setReady] = useState(false)
  onPickRef.current = onPick
  viewRef.current = { state, you, selectable }

  useEffect(() => {
    const parent = hostRef.current
    if (!parent) return
    let cancelled = false
    const size = () => ({
      width: Math.max(parent.clientWidth || window.innerWidth, 280),
      height: Math.max(parent.clientHeight || window.innerHeight, 420),
    })
    let game: Phaser.Game | null = null
    const bind = () => {
      if (cancelled || !game) return
      const scene = game.scene.getScene('PaquetScene') as PaquetScene | null
      if (!scene) return
      sceneRef.current = scene
      scene.setSelect((id) => onPickRef.current(id))
      scene.sync(viewRef.current)
      requestAnimationFrame(() => {
        if (!cancelled) setReady(true)
      })
    }
    const fit = () => {
      if (!game) return
      const next = size()
      game.scale.resize(next.width, next.height)
    }
    const ro = new ResizeObserver(fit)
    ro.observe(parent)
    window.visualViewport?.addEventListener('resize', fit)
    const boot = () => {
      if (cancelled) return
      if (parent.clientWidth < 16 || parent.clientHeight < 16) {
        requestAnimationFrame(boot)
        return
      }
      const start = size()
      game = new Phaser.Game({
        type: Phaser.CANVAS,
        parent,
        width: start.width,
        height: start.height,
        backgroundColor: '#071018',
        banner: false,
        audio: { noAudio: true },
        scale: {
          mode: Phaser.Scale.RESIZE,
          expandParent: false,
          autoRound: true,
        },
        render: { antialias: true, clearBeforeRender: true },
        scene: PaquetScene,
      })
      gameRef.current = game
      game.events.once(Phaser.Core.Events.READY, bind)
    }
    requestAnimationFrame(boot)
    return () => {
      cancelled = true
      ro.disconnect()
      window.visualViewport?.removeEventListener('resize', fit)
      sceneRef.current = null
      setReady(false)
      game?.destroy(true)
      gameRef.current = null
    }
  }, [])

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    scene.setSelect((id) => onPickRef.current(id))
    scene.sync({ state, you, selectable })
  }, [state, you, selectable])

  return <div ref={hostRef} className={`board board--phaser board--paquet ${ready ? 'is-ready' : ''}`} />
}
