// Guard dev-server client reload in Service Worker context (no window.location.reload)
try {
  // In MV3 Service Worker, self.location is WorkerLocation without reload();
  // Stub it to a no-op to avoid runtime errors from dev-server client.
  const loc: any = (globalThis as any)?.location

  if (loc && typeof loc.reload !== 'function') {
    loc.reload = () => {}
  }
} catch {
  // ignore
}
console.log('Minimum Chromium file loaded for reload purposes')
