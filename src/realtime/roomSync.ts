import { fetchRoom, isRoomUnchanged, type RoomSnapshot } from '../api/client'

function wsUrl(token: string) {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/ws?token=${encodeURIComponent(token)}`
}

export function connectRoomSync({
  token,
  code,
  onRoom,
  onCoins,
  onGone,
}: {
  token: string
  code: string
  onRoom: (room: RoomSnapshot) => void
  onCoins?: (coins: number) => void
  onGone?: () => void
}): () => void {
  let stopped = false
  let socket: WebSocket | null = null
  let pollId = 0
  let retry = 0
  let rev = -1
  let polling = false
  let reconnectTimer = 0

  const apply = (room: RoomSnapshot) => {
    if (typeof room.rev === 'number') rev = room.rev
    onRoom(room)
    if (typeof room.coins === 'number') onCoins?.(room.coins)
  }

  const pollOnce = () => {
    if (stopped || !polling) return
    fetchRoom(token, code, rev >= 0 ? rev : undefined)
      .then((next) => {
        if (stopped) return
        if (isRoomUnchanged(next)) {
          rev = next.rev
          return
        }
        apply(next)
      })
      .catch(() => undefined)
  }

  const startPoll = () => {
    if (stopped || polling) return
    polling = true
    pollOnce()
    pollId = window.setInterval(pollOnce, 900)
  }

  const stopPoll = () => {
    polling = false
    if (pollId) window.clearInterval(pollId)
    pollId = 0
  }

  const open = () => {
    if (stopped) return
    const ws = new WebSocket(wsUrl(token))
    socket = ws

    ws.onopen = () => {
      retry = 0
      ws.send(JSON.stringify({ type: 'watch', code }))
    }

    ws.onmessage = (event) => {
      let msg: { type?: string; room?: RoomSnapshot }
      try {
        msg = JSON.parse(String(event.data)) as { type?: string; room?: RoomSnapshot }
      } catch {
        return
      }
      if (msg.type === 'gone') {
        onGone?.()
        return
      }
      if (msg.type === 'room' && msg.room) apply(msg.room)
    }

    ws.onclose = () => {
      if (stopped) return
      retry += 1
      startPoll()
      const wait = Math.min(8000, 400 * 2 ** Math.min(retry, 5))
      reconnectTimer = window.setTimeout(open, wait)
    }

    ws.onerror = () => {
      try {
        ws.close()
      } catch {
        /* ignore */
      }
    }
  }

  open()
  startPoll()

  return () => {
    stopped = true
    stopPoll()
    if (reconnectTimer) window.clearTimeout(reconnectTimer)
    try {
      socket?.close()
    } catch {
      /* ignore */
    }
  }
}
