import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'

// ready.json is read by tools while it is written, so one module owns the
// write and the read: lib/ready-contract-writer.ts. Every other place hands
// it a patch or takes the record it read. Specs read the file by hand on
// purpose, as the check on that module, and are not scanned.
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

// Everything in node:fs that takes the bytes of a path.
const FS_READ =
  /\b(?:readFileSync|readFile|createReadStream|readSync)\s*\(([^;{}]{0,240}?)\)/g

function readsOf(text: string): string[] {
  const found: string[] = []

  for (const call of text.matchAll(FS_READ)) {
    if (READY_PATH.test(call[1])) found.push(call[0])
  }

  // A parse fed by a helper that was handed the ready path is a reader too.
  for (const call of text.matchAll(
    /JSON\.parse\(\s*\w+\(\s*ready\w*Path\w*[^;{}]{0,80}?\)/gi
  )) {
    found.push(call[0])
  }

  return [...new Set(found)]
}

// The names a file takes from the one module, read off its import.
function takenFromTheWriter(text: string): string[] {
  const taken = text.match(
    /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'[./]+(?:develop\/)?(?:lib\/)?ready-contract-writer'/
  )

  return taken
    ? taken[1]
        .split(',')
        .map((name) => name.replace(/^\s*type\s+/, '').trim())
        .filter(Boolean)
    : []
}

const WRITING_NAMES = ['writeReadyRecord', 'patchReadyRecord']

const takes = (text: string, writing: boolean) => {
  const names = takenFromTheWriter(text)

  return (
    names.length > 0 &&
    names.some((name) => WRITING_NAMES.includes(name)) === writing
  )
}

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
        .filter(({text}) => takes(text, true))
        .map(({file}) => file)
        .sort()
    ).toEqual([
      'develop/plugin-browsers/launch-timeout-stamp.ts',
      'develop/plugin-ready-contract/index.ts',
      'extension/browsers/browsers-lib/ready-stamp.ts'
    ])
  })

  it('names the files that only take the record it read', () => {
    expect(
      sources
        .filter(({text}) => takes(text, false))
        .map(({file}) => file)
        .sort()
    ).toEqual([
      'develop/command-preview.ts',
      'develop/command-steps/build-receipt.ts',
      'develop/dev-server/control-bridge/consumer-client.ts',
      'develop/dev-server/lifecycle-stream.ts',
      'develop/lib/live-dev-session.ts',
      'extension/browsers/browsers-lib/banner.ts',
      'extension/commands/dev-wait.ts',
      'extension/commands/doctor.ts'
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

  it('reads and parses the file in that same module only', () => {
    const readers = sources
      .filter(({text}) => readsOf(text).length > 0)
      .map(({file, text}) => `${file}: ${readsOf(text).join(' | ')}`)

    expect(readers).toHaveLength(1)
    expect(readers[0].startsWith(`${WRITER}: `)).toBe(true)
  })

  it('retries a refused rename in one implementation', () => {
    expect(
      sources
        .filter(({text}) =>
          /function renameSyncWithRetry\b|RETRYABLE_RENAME_CODES\s*=/.test(text)
        )
        .map(({file}) => file)
    ).toEqual(['develop/lib/rename-with-retry.ts'])
  })

  it('finds a second reader when one is added', () => {
    const secondReaders = [
      "JSON.parse(fs.readFileSync(readyPath, 'utf-8'))\n",
      "const text = fs.readFileSync(readyPathFor(outputPath), 'utf8')\n",
      "await fs.promises.readFile(readyContractPath(root, 'chrome'), 'utf8')\n",
      "fs.readFileSync(path.join(dir, 'ready.json'), 'utf8')\n",
      'JSON.parse(readText(readyPath))\n'
    ]

    for (const source of secondReaders) {
      expect(readsOf(source), source).not.toHaveLength(0)
    }

    expect(readsOf('readReadyRecord(readyPath)\n')).toHaveLength(0)
    expect(readsOf("fs.readFileSync(eventsPath, 'utf8')\n")).toHaveLength(0)
    expect(readsOf('fs.existsSync(readyPath)\n')).toHaveLength(0)
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
