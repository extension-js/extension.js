// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

// Strips the UTF-8 BOM some editors prepend; Chrome tolerates the BOM in every
// extension JSON it reads, so every parse of user-authored JSON must too.
export function stripBom(text: string | Buffer): string {
  const raw = typeof text === 'string' ? text : String(text || '')
  return raw && raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
}

// JSON.parse with BOM stripping; empty input parses as {}, invalid JSON still
// throws. Use JSON.parse(stripBom(...)) where empty must stay an error.
// The one sanctioned dynamic-JSON escape hatch: readers of user-authored JSON
// return this alias so the looseness is declared in exactly one place.
// biome-ignore lint/suspicious/noExplicitAny: JSON readers are dynamic by contract; callers narrow at their own boundary
export type ParsedJson = any

export function parseJsonSafe(text: string | Buffer): ParsedJson {
  const s = stripBom(text)
  return JSON.parse(s || '{}')
}
