export function formatDuration(ms: number): string {
  // Rounding to whole seconds read 400 ms as "0 seconds", and whole
  // minutes read better than a four-digit count of seconds.
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`
  if (ms >= 120_000 && ms % 60_000 === 0) return `${ms / 60_000} minutes`

  const seconds =
    ms < 10_000 ? Math.round(ms / 100) / 10 : Math.round(ms / 1000)

  return `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`
}
