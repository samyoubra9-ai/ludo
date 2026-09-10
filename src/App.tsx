import { useEffect, useState } from 'react'
import {
  createRoom,
  fetchMe,
  findMatch,
  joinRoom,
  leaveRoom,
  loginWallet,
  logoutWallet,
  moveRoom,
  rollRoom,
  startRoom,
  type RoomSnapshot,
} from './api/client'
import { GameScreen } from './components/GameScreen'
import { HomeScreen, type PlayMode } from './components/HomeScreen'
import { InstallPwa } from './components/InstallPwa'
import { RoomLobby } from './components/RoomLobby'
import { WalletGate } from './components/WalletGate'
import { clearSession, loadSession, saveSession, type LocalSession } from './identity/store'
import { resumeIfVisible, unlockAudio } from './audio/bus'
import { setMusic, THEME } from './audio/music'
import { unlockSfx } from './audio/sfx'
import { createGame } from './ludo/engine'
import { connectRoomSync } from './realtime/roomSync'
import type { ColorId, GameState, PlayerCount } from './ludo/types'
import type { Stake } from './ludo/wallet'
import './App.css'

export default function App() {
  const [session, setSession] = useState<LocalSession | null>(loadSession)
  const [ready, setReady] = useState(!loadSession())
  const [name, setName] = useState('')
  const [count, setCount] = useState<PlayerCount>(2)
  const [color, setColor] = useState<ColorId>('red')
  const [stake, setStake] = useState<Stake>(100)
  const [coins, setCoins] = useState(0)
  const [kioskName, setKioskName] = useState<string | null>(null)
  const [game, setGame] = useState<GameState | null>(null)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<PlayMode>('solo')
  const [joinCode, setJoinCode] = useState('')
  const [room, setRoom] = useState<RoomSnapshot | null>(null)
  const [roomBusy, setRoomBusy] = useState(false)
  const [resume, setResume] = useState<{ code: string; status: 'lobby' | 'playing' | 'ended' } | null>(null)

  useEffect(() => {
    if (!session) return
    let cancelled = false
    fetchMe(session.token)
      .then((me) => {
        if (cancelled) return
        setCoins(me.coins)
        setKioskName(me.kioskName ?? null)
        setResume(me.playing ?? null)
        setReady(true)
        if (me.playing?.code && me.playing.status === 'playing') {
          return joinRoom(session.token, {
            code: me.playing.code,
            name: name.trim() || shortName(session.address),
            color,
          }).then((next) => {
            if (!cancelled) setRoom(next)
          }).catch(() => {
            if (!cancelled) setResume(null)
          })
        }
      })
      .catch(() => {
        if (cancelled) return
        clearSession()
        setSession(null)
        setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [session])

  useEffect(() => {
    if (!session || game || room) return
    const token = session.token
    const refresh = () => {
      void fetchMe(token)
        .then((me) => {
          setCoins(me.coins)
          setKioskName(me.kioskName ?? null)
          setResume(me.playing ?? null)
        })
        .catch(() => undefined)
    }
    const onVis = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', refresh)
    const tick = window.setInterval(refresh, 8000)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', refresh)
      window.clearInterval(tick)
    }
  }, [session, game, room])

  useEffect(() => {
    const once = () => {
      unlockSfx()
      unlockAudio()
    }
    window.addEventListener('pointerdown', once, { once: true })
    window.addEventListener('visibilitychange', resumeIfVisible)
    return () => {
      window.removeEventListener('pointerdown', once)
      window.removeEventListener('visibilitychange', resumeIfVisible)
    }
  }, [])

  const inPlay = Boolean(
    game || (room?.game && room.you && (room.status === 'playing' || room.status === 'ended')),
  )

  useEffect(() => {
    if (!session) {
      setMusic('off')
      return
    }
    setMusic(inPlay ? 'play' : 'lobby')
  }, [session, inPlay, THEME])

  useEffect(() => {
    if (!session || !room || room.status === 'ended') return
    const token = session.token
    const code = room.code
    return connectRoomSync({
      token,
      code,
      onRoom: (next) => {
        setRoom((prev) => ({
          ...next,
          urls: next.urls?.length ? next.urls : prev?.urls ?? [],
        }))
      },
      onCoins: setCoins,
      onGone: () => {
        setRoom(null)
        setError('Salle fermée.')
      },
    })
  }, [session, room?.code, room?.status])

  const unlock = async (payload: { address: string; loginToken: string }) => {
    const me = await loginWallet(payload.address, payload.loginToken)
    if (!me.token) throw new Error('Session serveur manquante.')
    const next = { address: me.address, token: me.token }
    saveSession(next)
    setSession(next)
    setCoins(me.coins)
    setKioskName(me.kioskName ?? null)
  }

  const lock = () => {
    if (session) void logoutWallet(session.token)
    clearSession()
    setSession(null)
    setGame(null)
    setRoom(null)
    setResume(null)
    setKioskName(null)
  }

  const play = async () => {
    if (!session) return
    setError('')
    const matchId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
    setGame(createGame(name.trim() || shortName(session.address), count, color, 0, coins, matchId))
  }

  const queueMatch = async () => {
    if (!session || coins < stake) return
    setError('')
    setRoomBusy(true)
    try {
      const next = await findMatch(session.token, {
        name: name.trim() || shortName(session.address),
        color,
        count,
        stake,
      })
      setRoom(next)
      setResume({ code: next.code, status: next.status })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Recherche impossible.')
    } finally {
      setRoomBusy(false)
    }
  }

  const openRoom = async () => {
    if (!session || coins < stake) return
    setError('')
    setRoomBusy(true)
    try {
      const next = await createRoom(session.token, {
        name: name.trim() || shortName(session.address),
        color,
        count,
        stake,
      })
      setRoom(next)
      setResume({ code: next.code, status: next.status })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Serveur injoignable.')
    } finally {
      setRoomBusy(false)
    }
  }

  const enterRoom = async () => {
    if (!session || joinCode.length !== 4) return
    setError('')
    setRoomBusy(true)
    try {
      const next = await joinRoom(session.token, {
        code: joinCode,
        name: name.trim() || shortName(session.address),
        color,
      })
      setRoom(next)
      setResume({ code: next.code, status: next.status })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Salle introuvable.')
    } finally {
      setRoomBusy(false)
    }
  }

  const resumeRoom = async () => {
    if (!session || !resume) return
    setError('')
    setRoomBusy(true)
    try {
      const next = await joinRoom(session.token, {
        code: resume.code,
        name: name.trim() || shortName(session.address),
        color,
      })
      setRoom(next)
      setResume({ code: next.code, status: next.status })
    } catch (err) {
      setResume(null)
      setError(err instanceof Error ? err.message : 'Salle introuvable.')
    } finally {
      setRoomBusy(false)
    }
  }

  const launchRoom = async () => {
    if (!session || !room) return
    setError('')
    setRoomBusy(true)
    try {
      setRoom(await startRoom(session.token, room.code))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de lancer.')
    } finally {
      setRoomBusy(false)
    }
  }

  const dropRoom = async () => {
    if (session && room) {
      try {
        await leaveRoom(session.token, room.code)
      } catch {
        /* keep leaving */
      }
      try {
        const me = await fetchMe(session.token)
        setCoins(me.coins)
        setKioskName(me.kioskName ?? null)
        setResume(me.playing ?? null)
      } catch {
        /* keep last known */
      }
    }
    setRoom(null)
    setError('')
  }

  const leave = async () => {
    if (room) {
      await dropRoom()
      return
    }
    if (!session) {
      setGame(null)
      return
    }
    try {
      const me = await fetchMe(session.token)
      setCoins(me.coins)
      setKioskName(me.kioskName ?? null)
    } catch {
      /* keep last known */
    }
    setGame(null)
  }

  if (!ready) {
    return (
      <div className="app">
        <InstallPwa />
        <section className="lobby">
          <p className="logo__tag">Connexion au serveur…</p>
        </section>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="app">
        <InstallPwa />
        <WalletGate onReady={unlock} />
      </div>
    )
  }

  const lanGame = room?.game && room.you && (room.status === 'playing' || room.status === 'ended')

  return (
    <div className={`app ${lanGame || game ? 'is-play' : ''}`}>
      {lanGame || game ? null : <InstallPwa />}
      {lanGame && room.game && room.you ? (
        <GameScreen
          initial={room.game}
          live={room.game}
          remote={{
            myColor: room.you,
            rolling: room.rolling,
            notice: room.notice,
            forfeitWinAt: room.forfeitWinAt,
            turnDueAt: room.turnDueAt,
            abandoned: room.status === 'ended' && !room.game.winner,
            onRoll: () => {
              void rollRoom(session.token, room.code).then(setRoom).catch(() => undefined)
            },
            onMove: (tokenId) => {
              void moveRoom(session.token, room.code, tokenId).then(setRoom).catch(() => undefined)
            },
          }}
          onExit={() => void leave()}
        />
      ) : game ? (
        <GameScreen initial={game} onExit={() => void leave()} />
      ) : room ? (
        <RoomLobby
          room={room}
          isHost={room.host === session.address}
          error={error}
          busy={roomBusy}
          onStart={() => void launchRoom()}
          onLeave={() => void dropRoom()}
        />
      ) : (
        <HomeScreen
          name={name}
          count={count}
          color={color}
          stake={stake}
          coins={coins}
          kioskName={kioskName}
          address={session.address}
          error={error}
          mode={mode}
          joinCode={joinCode}
          resume={resume}
          onName={setName}
          onCount={setCount}
          onColor={setColor}
          onStake={setStake}
          onPlay={() => void play()}
          onLock={lock}
          onMode={setMode}
          onJoinCode={setJoinCode}
          onCreateRoom={() => void openRoom()}
          onJoinRoom={() => void enterRoom()}
          onFindMatch={() => void queueMatch()}
          onResumeRoom={() => void resumeRoom()}
        />
      )}
    </div>
  )
}

function shortName(address: string) {
  return address.slice(2, 8).toUpperCase()
}
