import { useEffect, useState } from 'react'
import { demoVehicle, VehicleData } from './vehicle'

export const VEHICLE_POLL_MS = 200 // the Vehicle panel's refresh
export const VEHICLE_STATUS_POLL_MS = 2000 // other native pages: the strip's outside temperature, Settings > Status's bus row

// Demo mode: open the app with ?demo=1 to see the Vehicle screens move without CAN data.
export const vehicleDemo = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('demo')

// Polls /api/vehicle every `intervalMs` while a screen needs it; pass null to stop, so the CAN
// service has nothing to do and CarPlay gets every CPU cycle. Null until the first answer, and again
// when the API or the CAN service is missing, so the panel shows "--".
export const useVehicle = (intervalMs: number | null): VehicleData | null => {
  const [data, setData] = useState<VehicleData | null>(null)

  useEffect(() => {
    if (intervalMs === null) return
    let cancelled = false
    if (vehicleDemo) {
      const t0 = Date.now()
      const tick = () => setData(demoVehicle((Date.now() - t0) / 1000))
      tick()
      const id = setInterval(tick, intervalMs)
      return () => clearInterval(id)
    }
    const poll = async () => {
      try {
        const res = await fetch('/api/vehicle', { cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = (await res.json()) as VehicleData
        if (!cancelled) setData(body)
      } catch {
        if (!cancelled) setData(null)
      }
    }
    poll()
    const id = setInterval(poll, intervalMs)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [intervalMs])

  return data
}
