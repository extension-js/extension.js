export function log(label, f) {
  return async () => {
    console.group(label)
    await Promise.resolve().then(f).catch(console.error)
    console.groupEnd()
  }
}
export function test(expr, ...args) {
  if (expr) console.log('[✅]', ...args)
  else console.error('[❌]', ...args)
}
