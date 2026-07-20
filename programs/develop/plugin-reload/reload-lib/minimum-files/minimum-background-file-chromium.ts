// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

try {
  // In MV3 Service Worker, self.location is WorkerLocation without reload();
  // Stub it to a no-op to avoid runtime errors from dev-server client.
  const loc = (globalThis as {location?: {reload?: unknown}} | undefined)
    ?.location as {reload?: () => void} | undefined

  if (loc && typeof loc.reload !== 'function') {
    loc.reload = () => {}
  }
} catch {
  // Ignore
}
console.log('Minimum Chromium file loaded for reload purposes')
