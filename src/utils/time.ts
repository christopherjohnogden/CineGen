import { TICKS_PER_SECOND } from '../engine/mockEngine'

export function ticksToSeconds(tick: number): number {
  return tick / TICKS_PER_SECOND
}

export function formatTicksToTimecode(tick: number): string {
  const totalSeconds = Math.max(0, Math.floor(ticksToSeconds(tick)))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return [hours, minutes, seconds].map((part) => part.toString().padStart(2, '0')).join(':')
}

export function secondsToTicks(seconds: number): number {
  return Math.floor(seconds * TICKS_PER_SECOND)
}
