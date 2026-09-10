import { useEffect, useRef, useState } from 'react'
import Phaser from 'phaser'
import { LudoScene, LUDO_SIZE, type BoardSync } from '../phaser/LudoScene'
import type { Token } from '../ludo/types'

export function Board({
  tokens,
  selectedId,
  movable,
  pot,
  onSelect,
}: {
  tokens: Token[]
  selectedId: string | null
  movable: string[]
  pot: number
  onSelect: (id: string) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const gameRef = useRef<Phaser.Game | null>(null)
  const sceneRef = useRef<LudoScene | null>(null)
  const onSelectRef = useRef(onSelect)
  const viewRef = useRef<BoardSync>({ tokens, selectedId, movable, pot })
  const [ready, setReady] = useState(false)
  onSelectRef.current = onSelect
  viewRef.current = { tokens, selectedId, movable, pot }

  useEffect(() => {
    const parent = hostRef.current
    if (!parent) return
    let cancelled = false

    const game = new Phaser.Game({
      type: Phaser.CANVAS,
      parent,
      width: LUDO_SIZE,
      height: LUDO_SIZE,
      backgroundColor: '#4a2d0c',
      banner: false,
      audio: { noAudio: true },
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      render: { antialias: true, clearBeforeRender: true },
      scene: LudoScene,
    })
    gameRef.current = game

    const bind = () => {
      if (cancelled) return
      const scene = game.scene.getScene('LudoScene') as LudoScene | null
      if (!scene) return
      sceneRef.current = scene
      scene.setSelect((id) => onSelectRef.current(id))
      scene.sync(viewRef.current)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!cancelled) setReady(true)
        })
      })
    }

    game.events.once(Phaser.Core.Events.READY, bind)

    return () => {
      cancelled = true
      sceneRef.current = null
      setReady(false)
      game.destroy(true)
      gameRef.current = null
    }
  }, [])

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    scene.setSelect((id) => onSelectRef.current(id))
    scene.sync({ tokens, selectedId, movable, pot })
  }, [tokens, selectedId, movable, pot])

  return <div ref={hostRef} className={`board board--phaser ${ready ? 'is-ready' : ''}`} />
}
