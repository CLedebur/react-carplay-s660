import { useEffect, useState } from 'react'
import { PowerAction } from './nav'

// Readings from the kiosk's local API (hardware/path-b/s660-api.js). Null = source missing.
export interface SystemStats {
  cpuTempC: number | null
  nvmeTempC: number | null
  cpuLoadPct: number | null
  memUsedMb: number | null
  memTotalMb: number | null
  power: {
    underVoltageNow: boolean
    throttledNow: boolean
    softTempLimitNow: boolean
    underVoltageEver: boolean
  } | null
  uptimeSec: number | null
  overlayRoot: boolean
  persistFreeGb: number | null
  mitmLinked: boolean
  videoDecoderBusy: boolean | null
}

// Polls while `intervalMs` is set; pass null to stop (the CarPlay stream gets every CPU cycle).
// `full` adds the slower decoder check. Returns null until the first answer, and again if the API
// is unreachable (npm start has no API), so the panel shows "--".
export const useSystemStats = (intervalMs: number | null, full: boolean): SystemStats | null => {
  const [stats, setStats] = useState<SystemStats | null>(null)

  useEffect(() => {
    if (intervalMs === null) return
    let cancelled = false
    const poll = async () => {
      try {
        const res = await fetch(`/api/stats${full ? '?full=1' : ''}`, { cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = (await res.json()) as SystemStats
        if (!cancelled) setStats(body)
      } catch {
        if (!cancelled) setStats(null)
      }
    }
    poll()
    const id = setInterval(poll, intervalMs)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [intervalMs, full])

  return stats
}

export const requestPower = async (action: PowerAction): Promise<void> => {
  const res = await fetch('/api/power', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-s660-ui': '1' },
    body: JSON.stringify({ action }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.error ?? `HTTP ${res.status}`)
  }
}
