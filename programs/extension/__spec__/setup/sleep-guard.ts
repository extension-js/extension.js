import {execFileSync} from 'node:child_process'

// A closed lid puts macOS into maintenance sleep for about fifteen minutes at
// a time. Every timer in a run that spans it fires on wake and fails the row.
export interface SleepWindow {
  sleptAt: number
  wokeAt: number
}

function readKernelTime(name: string): number | undefined {
  try {
    const text = execFileSync('sysctl', ['-n', name], {
      encoding: 'utf8',
      timeout: 2000
    })
    const match = /sec = (\d+)/.exec(text)

    return match ? Number(match[1]) * 1000 : undefined
  } catch {
    return undefined
  }
}

export function lastSleepWindow(
  platform: NodeJS.Platform = process.platform,
  read: (name: string) => number | undefined = readKernelTime
): SleepWindow | undefined {
  if (platform !== 'darwin') return undefined

  const sleptAt = read('kern.sleeptime')
  const wokeAt = read('kern.waketime')

  if (!sleptAt || !wokeAt || wokeAt < sleptAt) return undefined

  return {sleptAt, wokeAt}
}

// The note a failure carries when the system slept while it ran, or nothing.
export function sleptDuring(
  startedAt: number,
  window: SleepWindow | undefined
): string | undefined {
  if (!window || window.wokeAt <= startedAt) return undefined

  const seconds = Math.round((window.wokeAt - window.sleptAt) / 1000)
  const from = new Date(window.sleptAt).toLocaleTimeString()
  const to = new Date(window.wokeAt).toLocaleTimeString()

  return (
    `macOS slept for ${seconds} s (${from} to ${to}) while this ran, so ` +
    'its timers fired on wake. Rerun with the lid open or under `caffeinate -s`.'
  )
}
