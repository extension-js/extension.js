import * as fs from 'node:fs'
import * as path from 'node:path'
import {CLI_ROOT} from './run-cli'

export const CLI_VERSION: string = JSON.parse(
  fs.readFileSync(path.join(CLI_ROOT, 'package.json'), 'utf8')
).version

// Where the compiled CLI loads develop's loaders from, as a warning prints it.
export const DEVELOP_DIST = fs.realpathSync(
  path.join(CLI_ROOT, '..', 'develop', 'dist')
)

// Each pair is a literal and the name a spec writes in its place.
export type Placeholders = Array<[literal: string, name: string]>

function replaceLiterals(text: string, placeholders: Placeholders): string {
  const longestFirst = [
    ...placeholders,
    [DEVELOP_DIST, '<develop-dist>'] as [string, string],
    [process.version, '<node>'] as [string, string],
    [CLI_VERSION, '<version>'] as [string, string]
  ].sort((a, b) => b[0].length - a[0].length)

  return longestFirst.reduce(
    (out, [literal, name]) => out.split(literal).join(name),
    text
  )
}

// What changes from run to run is named, and every other byte is compared.
export function normalizeTranscript(
  text: string,
  placeholders: Placeholders = []
): string {
  return replaceLiterals(text, placeholders)
    .replace(/\[\d{2}:\d{2}:\d{2}\]/g, '[hh:mm:ss]')
    .replace(/ in \d+ ms/g, ' in N ms')
    .replace(/\(\d+(?:\.\d+)?KB\)/g, '(N KB)')
    .replace(/\(\d+ B\)/g, '(N B)')
}

const BYTE_COUNTS = new Set([
  'total_bytes',
  'largest_asset_bytes',
  'size',
  'durationMs'
])

export function normalizeFrame(
  frame: unknown,
  placeholders: Placeholders = []
): unknown {
  return JSON.parse(
    replaceLiterals(JSON.stringify(frame), placeholders),
    (key, value) =>
      BYTE_COUNTS.has(key) && typeof value === 'number' ? 0 : value
  )
}
