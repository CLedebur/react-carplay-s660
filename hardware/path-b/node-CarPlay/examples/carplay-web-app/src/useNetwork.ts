import { useCallback, useEffect, useState } from 'react'

// Which way the unit is online, from the kiosk's local API (hardware/path-b/s660-api.js).
export type LinkType = 'wifi' | 'bluetooth' | 'ethernet'

export interface NetworkLink {
  type: LinkType
  state: string // NetworkManager's: connected, disconnected, unavailable, ...
  name: string | null // Wi-Fi network name, or the tethering profile
  ip: string | null
  signal: number | null // Wi-Fi, 0-100
}

export interface NetworkInfo {
  links: NetworkLink[]
  via: LinkType | null // the link the default route uses
  internet: boolean // a real request got through
  savedWifi: number
  bluetoothProfile: string | null // the phone set up for tethering, if any
}

// Polls while `intervalMs` is set; null stops it. Null result = no answer (npm start has no API).
export const useNetwork = (intervalMs: number | null): { network: NetworkInfo | null; refresh: () => void } => {
  const [network, setNetwork] = useState<NetworkInfo | null>(null)
  const [tick, setTick] = useState(0)
  const refresh = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (intervalMs === null) return
    let cancelled = false
    const poll = async () => {
      try {
        const res = await fetch('/api/network', { cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = (await res.json()) as NetworkInfo
        if (!cancelled) setNetwork(body)
      } catch {
        if (!cancelled) setNetwork(null)
      }
    }
    poll()
    const id = setInterval(poll, intervalMs)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [intervalMs, tick])

  return { network, refresh }
}

export const requestBluetoothConnect = async (): Promise<void> => {
  const res = await fetch('/api/network/connect', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-s660-ui': '1' },
    body: JSON.stringify({ link: 'bluetooth' }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.error ?? `HTTP ${res.status}`)
  }
}
