import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'

// ready.json is read by tools while it is written, so one module owns the
// write: lib/ready-contract-writer.ts. Every other place hands it a patch.
const programsRoot = path.resolve(__dirname, '..', '..')
const PROGRAMS = ['develop', 'extension']
const WRITER = 'develop/lib/ready-contract-writer.ts'
const SKIPPED_FOLDERS = new Set(['node_modules', 'dist', '__spec__', '.turbo'])

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
    const full = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      return SKIPPED_FOLDERS.has(entry.name) ? [] : sourceFiles(full)
    }

    return /\.(?:ts|tsx|js|mjs|cjs)$/.test(entry.name) &&
      !/\.(?:spec|test|d)\.[a-z]+$/.test(entry.name)
      ? [full]
      : []
  })
}

const sources = PROGRAMS.flatMap((program) =>
  sourceFiles(path.join(programsRoot, program))
).map((file) => ({
  file: path.relative(programsRoot, file).split(path.sep).join('/'),
  text: fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
}))

// An expression that names ready.json: the path variables and helpers of
// both programs, or the file name itself.
const READY_PATH = /ready\.json|\bready\w*Path\w*/i

// Everything in node:fs that puts bytes at a path, and the retried rename.
const FS_WRITE =
  /\b(?:writeFileSync|writeFile|appendFileSync|appendFile|renameSync|rename|renameSyncWithRetry|copyFileSync|copyFile|cpSync|cp|createWriteStream|openSync|truncateSync)\s*\(([^;{}]{0,240}?)\)/g

// Any helper with a writing name that is handed the ready path first.
const HELPER_WRITE =
  /\b(\w*(?:write|rename|save|persist|store|dump)\w*)\s*\(\s*(?:\w+\()?\s*ready\w*Path\w*/gi

// The calls that reach the one writer: its two exports, and the two
// wrappers the engine's contract writer adds its warning in.
const SANCTIONED_HELPERS = new Set([
  'writeReadyRecord',
  'patchReadyRecord',
  'writeContractFile',
  'patchContractFile'
])

function writesOf(text: string): string[] {
  const found: string[] = []

  for (const call of text.matchAll(FS_WRITE)) {
    if (READY_PATH.test(call[1])) found.push(call[0])
  }

  for (const call of text.matchAll(HELPER_WRITE)) {
    if (!SANCTIONED_HELPERS.has(call[1])) found.push(call[0])
  }

  // A temp file named after ready.json is half of a second atomic write.
  for (const temp of text.matchAll(
    /ready\w*Path\w*[^\n]{0,6}\.tmp|ready\.json\.tmp/gi
  )) {
    found.push(temp[0])
  }

  return found
}

const importsTheWriter = (text: string) =>
  /from '(?:\.\.?\/)+(?:develop\/)?(?:lib\/)?ready-contract-writer'/.test(text)

describe('who writes ready.json in the engine and the CLI', () => {
  it('reads the sources of both programs', () => {
    expect(sources.length).toBeGreaterThan(300)
    expect(sources.map(({file}) => file)).toContain(WRITER)
  })

  it('writes and renames the file in one module only', () => {
    const writers = sources
      .filter(({text}) => writesOf(text).length > 0)
      .map(
        ({file}) =>
          `${file}: ${writesOf(sources.find((s) => s.file === file)?.text ?? '').join(' | ')}`
      )

    expect(writers).toHaveLength(1)
    expect(writers[0].startsWith(`${WRITER}: `)).toBe(true)
  })

  it('names the files that hand the writer a patch', () => {
    expect(
      sources
        .filter(({text}) => importsTheWriter(text))
        .map(({file}) => file)
        .sort()
    ).toEqual([
      'develop/plugin-browsers/launch-timeout-stamp.ts',
      'develop/plugin-ready-contract/index.ts',
      'extension/browsers/browsers-lib/ready-stamp.ts'
    ])
  })

  it('keeps the wrappers of the engine writer on the one write', () => {
    const plugin =
      sources.find(
        ({file}) => file === 'develop/plugin-ready-contract/index.ts'
      )?.text ?? ''

    expect(plugin).toMatch(
      /function writeContractFile\([^{]*\) \{\n {2}noteContractWrite\(filePath, writeReadyRecord\(/
    )

    expect(plugin).toMatch(
      /function patchContractFile\([\s\S]{0,200}?\n\) \{\n {2}const result = patchReadyRecord\(/
    )
  })

  it('finds a second writer when one is added', () => {
    const secondWriters = [
      'const tmpPath = `$' + '{readyPath}.tmp-1`\n',
      "const tmpPath = readyPath + '.tmp-1'\n",
      'renameSyncWithRetry(tmpPath, readyPath)\n',
      'writeJsonAtomic(readyPath, ready)\n',
      "fs.writeFileSync(readyContractPath(root, 'chrome'), text)\n",
      "fs.writeFileSync(path.join(dir, 'ready.json'), text)\n",
      'fs.renameSync(tmp, readyPathFor(extensionOutputPath))\n'
    ]

    for (const source of secondWriters) {
      expect(writesOf(source), source).not.toHaveLength(0)
    }

    expect(writesOf('patchReadyRecord(readyPath, patch)\n')).toHaveLength(0)
    expect(writesOf('fs.writeFileSync(eventsPath, text)\n')).toHaveLength(0)
  })
})
