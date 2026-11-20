import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'

const FOLDER = path.resolve(__dirname, '..')

function sources(dir: string, prefix = ''): string[] {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
    if (entry.name === '__spec__' || entry.name === 'node_modules') return []

    return entry.isDirectory()
      ? sources(path.join(dir, entry.name), `${prefix}${entry.name}/`)
      : entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')
        ? [`${prefix}${entry.name}`]
        : []
  })
}

// The text of each catch block in a file, with the line it opens on. A
// comment on the line above the catch belongs to it, which is where a
// client written as strings keeps its reasons out of what it ships.
function catchBlocks(text: string): Array<{line: number; body: string}> {
  const blocks: Array<{line: number; body: string}> = []
  const lines = text.split('\n')
  const opener = /\bcatch\s*(?:\([^)]*\)\s*)?\{/g

  for (let match = opener.exec(text); match; match = opener.exec(text)) {
    let depth = 1
    let at = match.index + match[0].length

    while (depth > 0 && at < text.length) {
      if (text[at] === '{') depth += 1
      if (text[at] === '}') depth -= 1

      at += 1
    }

    const line = text.slice(0, match.index).split('\n').length
    const above = (lines[line - 2] || '').trim()

    blocks.push({
      line,
      body: [
        above.startsWith('//') ? above : '',
        text.slice(match.index + match[0].length, at - 1)
      ].join('\n')
    })
  }

  return blocks
}

// A catch that throws or calls something acts on the failure: it reports
// it, records it or hands it to the caller's fallback.
const REPORTS = /\bthrow\b|[A-Za-z_$][\w$.]*\(/
const NOT_A_REASON = ['ignore', 'noop', 'no-op']

// A reason is a comment of three words or more.
function saysWhy(body: string): boolean {
  return body.split('\n').some((line) => {
    const at = line.indexOf('//')
    if (at === -1) return false

    const words = line
      .slice(at + 2)
      .split(' ')
      .filter(Boolean)

    return words.length >= 3 && !NOT_A_REASON.includes(words[0].toLowerCase())
  })
}

const isSilent = (body: string) => !REPORTS.test(body) && !saysWhy(body)

describe('the catches of the reload plugin', () => {
  it('each act on the failure or say why it is safe to drop', () => {
    const silent = sources(FOLDER).flatMap((file) =>
      catchBlocks(fs.readFileSync(path.join(FOLDER, file), 'utf8'))
        .filter(({body}) => isSilent(body))
        .map(({line}) => `${file}:${line}`)
    )

    expect(silent).toEqual([])
  })

  it('reads a bare catch and an ignore note as silent', () => {
    const read = (body: string) =>
      catchBlocks(`try { run() } catch {${body}}`).filter((block) =>
        isSilent(block.body)
      ).length

    expect(read(' return false ')).toBe(1)
    expect(read('\n// Ignore\n')).toBe(1)
    expect(
      read('\n// A path that is gone is not a folder\nreturn false\n')
    ).toBe(0)

    expect(read(' throw coded(error) ')).toBe(0)
    expect(read(' cb(null) ')).toBe(0)
    expect(read(' identifier = "" ')).toBe(1)

    expect(
      catchBlocks(
        "'try { run() }' +\n// A tab that is gone has nothing to reload\n'catch (error) {}'"
      ).filter((block) => isSilent(block.body))
    ).toEqual([])
  })
})
