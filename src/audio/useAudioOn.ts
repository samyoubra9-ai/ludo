import { useEffect, useState } from 'react'
import { AUDIO_EVENT, isMusicOn, isSfxOn, setMusicOn, setSfxOn } from './bus'

export function useAudioPrefs() {
  const [music, setMusic] = useState(isMusicOn)
  const [sfx, setSfx] = useState(isSfxOn)

  useEffect(() => {
    const sync = () => {
      setMusic(isMusicOn())
      setSfx(isSfxOn())
    }
    window.addEventListener(AUDIO_EVENT, sync)
    return () => window.removeEventListener(AUDIO_EVENT, sync)
  }, [])

  return { music, sfx, setMusic: setMusicOn, setSfx: setSfxOn }
}
