/**
 * JSON.parse with BOM stripping. Handles the UTF-8 BOM (0xFEFF) that some
 * editors prepend to JSON files, which causes JSON.parse to throw.
 */
export function parseJsonSafe(text: string | Buffer): any {
  const raw = typeof text === 'string' ? text : String(text || '')
  const s = raw && raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
  return JSON.parse(s || '{}')
}
