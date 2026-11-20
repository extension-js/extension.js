// ██████╗ ███████╗██╗      ██████╗  █████╗ ██████╗
// ██╔══██╗██╔════╝██║     ██╔═══██╗██╔══██╗██╔══██╗
// ██████╔╝█████╗  ██║     ██║   ██║███████║██║  ██║
// ██╔══██╗██╔══╝  ██║     ██║   ██║██╔══██║██║  ██║
// ██║  ██║███████╗███████╗╚██████╔╝██║  ██║██████╔╝
// ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

try {
  // In MV3 Service Worker, self.location is WorkerLocation without reload();
  // Stub it to a no-op to avoid runtime errors from dev-server client.
  const loc = (globalThis as {location?: {reload?: unknown}} | undefined)
    ?.location as {reload?: () => void} | undefined

  if (loc && typeof loc.reload !== 'function') {
    loc.reload = () => {}
  }
} catch {
  // A frozen location keeps its own reload, which is all the stub is for
}

console.log('Minimum Chromium file loaded for reload purposes')
