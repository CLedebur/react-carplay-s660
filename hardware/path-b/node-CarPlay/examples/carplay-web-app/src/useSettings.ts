import { useCallback, useEffect, useRef, useState } from 'react'
import { defaultSettings, Settings } from './settings'

const post = async (patch: Partial<Settings>): Promise<Settings> => {
  const res = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-s660-ui': '1' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// Defaults until the server answers (and for good if it never does, e.g. under npm start).
// `loaded` turns true once the answer or the failure is in: CarPlay waits for it so the saved
// hand drive, frame rate and Wi-Fi band are what the dongle starts with.
// A change shows at once and is rolled back if the server cannot save it.
export const useSettings = () => {
  const [settings, setSettings] = useState<Settings>(defaultSettings)
  const [loaded, setLoaded] = useState(false)
  const latest = useRef(settings)
  latest.current = settings

  useEffect(() => {
    fetch('/api/settings', { cache: 'no-store', signal: AbortSignal.timeout(3000) })
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((saved: Settings) => setSettings({ ...defaultSettings, ...saved }))
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  const update = useCallback((patch: Partial<Settings>) => {
    const before = latest.current
    setSettings({ ...before, ...patch })
    post(patch).then(saved => setSettings(saved), () => setSettings(before))
  }, [])

  return { settings, loaded, update }
}
