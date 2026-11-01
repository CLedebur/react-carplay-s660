import { useCallback, useEffect, useState } from 'react'

// The built-in web interface (hardware/path-b/web-admin.js). It is off until switched on here, and the
// PIN to log in with exists only while it is on and is only ever shown on the unit's own screen.
export interface WebAdminState {
  enabled: boolean
  port: number
  pin: string | null
  urls: string[]
}

export const useWebAdmin = (intervalMs: number | null) => {
  const [web, setWeb] = useState<WebAdminState | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/webadmin', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setWeb((await res.json()) as WebAdminState)
    } catch {
      setWeb(null)
    }
  }, [])

  useEffect(() => {
    if (intervalMs === null) return
    refresh()
    const id = setInterval(refresh, intervalMs)
    return () => clearInterval(id)
  }, [intervalMs, refresh])

  const toggle = useCallback(async () => {
    try {
      const res = await fetch('/api/webadmin', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-s660-ui': '1' },
        body: JSON.stringify({ toggle: true }),
      })
      if (res.ok) setWeb((await res.json()) as WebAdminState)
    } catch {
      /* the next poll shows the real state */
    }
  }, [])

  return { web, toggle }
}
