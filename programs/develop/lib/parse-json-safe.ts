// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

/**
 * Strips the UTF-8 BOM (0xFEFF) that some editors prepend to JSON files.
 * Chrome tolerates the BOM in every extension JSON it reads (manifest.json,
 * declarativeNetRequest rulesets, _locales) — verified against live Chrome —
 * so every parse of user-authored JSON must strip it too.
 */
export function stripBom(text: string | Buffer): string {
  const raw = typeof text === 'string' ? text : String(text || '')
  return raw && raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
}

/**
 * JSON.parse with BOM stripping. Empty input parses as `{}`; invalid JSON
 * still throws. Use `JSON.parse(stripBom(...))` instead where empty input
 * must stay an error.
 */
export function parseJsonSafe(text: string | Buffer): any {
  const s = stripBom(text)
  return JSON.parse(s || '{}')
}
