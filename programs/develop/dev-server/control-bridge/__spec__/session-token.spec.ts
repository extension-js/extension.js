import {spawn} from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {CONTROL_TOKEN_FILE_PREFIX} from '../../../lib/session-paths'
import {
  clearControlToken,
  controlTokenPath,
  legacyControlTokenPath,
  readControlToken,
  writeControlToken
} from '../session-token'

const TOKEN_SHAPE = /^[0-9a-f]{64}$/
const posixOnly = process.platform === 'win32' ? it.skip : it

let project: string

function stateDir(): string {
  return path.dirname(controlTokenPath(project, 'chrome'))
}

function errorWithCode(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: rename refused`), {code})
}

// Reads the token file in a tight loop from another process, the way an
// `extension eval` racing a restarting dev session does.
const READER_SOURCE = `
const fs = require('node:fs')
const [file, stopFile] = process.argv.slice(1)
const counts = {reads: 0, empty: 0, malformed: 0, missing: 0}
let announced = false

function tick() {
  for (let i = 0; i < 500; i++) {
    try {
      const value = fs.readFileSync(file, 'utf-8')
      counts.reads++
      if (value === '') counts.empty++
      else if (!/^[0-9a-f]{64}$/.test(value)) counts.malformed++
    } catch {
      counts.missing++
    }
  }

  if (!announced) {
    announced = true
    process.stdout.write('ready\\n')
  }

  if (fs.existsSync(stopFile)) {
    process.stdout.write(JSON.stringify(counts) + '\\n')
    return
  }

  setImmediate(tick)
}

tick()
`

beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-token-'))
})

afterEach(() => {
  fs.rmSync(project, {recursive: true, force: true})
})

describe('writeControlToken', () => {
  it('writes the per-browser token and the legacy mirror', () => {
    const token = writeControlToken(project, 'chrome')

    expect(token).toMatch(TOKEN_SHAPE)
    expect(fs.readFileSync(controlTokenPath(project, 'chrome'), 'utf-8')).toBe(
      token
    )

    expect(fs.readFileSync(legacyControlTokenPath(project), 'utf-8')).toBe(
      token
    )

    expect(readControlToken(project, 'chrome')).toBe(token)
  })

  posixOnly('keeps both files owner-only across an overwrite', () => {
    writeControlToken(project, 'chrome')
    writeControlToken(project, 'chrome')

    for (const file of [
      controlTokenPath(project, 'chrome'),
      legacyControlTokenPath(project)
    ]) {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600)
    }
  })

  it('leaves no temp file behind', () => {
    writeControlToken(project, 'chrome')
    writeControlToken(project, 'chrome')

    expect(fs.readdirSync(stateDir()).sort()).toEqual(
      [
        path.basename(controlTokenPath(project, 'chrome')),
        path.basename(legacyControlTokenPath(project))
      ].sort()
    )
  })

  it('renames a whole temp file from the same directory onto each slot', () => {
    const renames: Array<{from: string; to: string; content: string}> = []

    const token = writeControlToken(project, 'chrome', {
      rename: (from, to) => {
        renames.push({from, to, content: fs.readFileSync(from, 'utf-8')})
        fs.renameSync(from, to)
      }
    })

    expect(renames.map((entry) => entry.to)).toEqual([
      controlTokenPath(project, 'chrome'),
      legacyControlTokenPath(project)
    ])

    for (const entry of renames) {
      expect(entry.content).toBe(token)
      expect(path.dirname(entry.from)).toBe(path.dirname(entry.to))
      // The per-browser scan matches on this prefix, so a temp must not.
      expect(
        path.basename(entry.from).startsWith(CONTROL_TOKEN_FILE_PREFIX)
      ).toBe(false)

      expect(path.basename(entry.from)).not.toBe(path.basename(entry.to))
    }
  })

  it.each([
    'EPERM',
    'EBUSY'
  ])('falls back to a direct write when the rename fails with %s', (code) => {
    const stale = writeControlToken(project, 'chrome')

    const token = writeControlToken(project, 'chrome', {
      rename: () => {
        throw errorWithCode(code)
      }
    })

    expect(token).not.toBe(stale)
    expect(readControlToken(project, 'chrome')).toBe(token)
    expect(fs.readFileSync(legacyControlTokenPath(project), 'utf-8')).toBe(
      token
    )

    expect(
      fs.readdirSync(stateDir()).filter((name) => name.endsWith('.tmp'))
    ).toEqual([])
  })

  it('surfaces any other rename failure and removes the temp file', () => {
    expect(() =>
      writeControlToken(project, 'chrome', {
        rename: () => {
          throw errorWithCode('EIO')
        }
      })
    ).toThrow(/EIO/)

    expect(fs.readdirSync(stateDir())).toEqual([])
  })

  it('a stray temp file never counts as a per-browser token', () => {
    const legacy = legacyControlTokenPath(project)

    fs.mkdirSync(stateDir(), {recursive: true})
    fs.writeFileSync(legacy, 'legacy-token')
    fs.writeFileSync(
      path.join(
        stateDir(),
        `.${path.basename(controlTokenPath(project, 'chrome'))}.123-abc.tmp`
      ),
      'half-written'
    )

    // With only a temp beside it, the legacy slot still speaks for the layout.
    expect(readControlToken(project, 'chrome')).toBe('legacy-token')
    expect(readControlToken(project, 'firefox')).toBe('legacy-token')
  })

  it('clears only the slots that still hold its own token', () => {
    const first = writeControlToken(project, 'chrome')
    const second = writeControlToken(project, 'chrome')

    clearControlToken(project, 'chrome', first)
    expect(readControlToken(project, 'chrome')).toBe(second)

    clearControlToken(project, 'chrome', second)
    expect(readControlToken(project, 'chrome')).toBeNull()
  })

  // Windows can refuse the rename while the reader holds the file, and the
  // direct-write fallback is allowed to show an empty file there.
  posixOnly(
    'a concurrent reader never observes an empty file across 200 overwrites',
    async () => {
      writeControlToken(project, 'chrome')

      const file = controlTokenPath(project, 'chrome')
      const stopFile = path.join(project, 'stop-reader')
      const reader = spawn(
        process.execPath,
        ['-e', READER_SOURCE, file, stopFile],
        {stdio: ['ignore', 'pipe', 'inherit']}
      )

      let stdout = ''

      let onReady: () => void = () => {}

      const ready = new Promise<void>((resolve) => {
        onReady = resolve
      })
      const exited = new Promise<void>((resolve) => {
        reader.once('close', () => resolve())
      })

      reader.stdout.setEncoding('utf-8')
      reader.stdout.on('data', (chunk: string) => {
        stdout += chunk
        if (stdout.includes('ready')) onReady()
      })

      try {
        await ready

        for (let i = 0; i < 200; i++) {
          writeControlToken(project, 'chrome')
          // Yield so the reader runs between overwrites on a single core too.
          if (i % 10 === 0) await new Promise((r) => setTimeout(r, 1))
        }
      } finally {
        fs.writeFileSync(stopFile, '')
        await exited
      }

      const lines = stdout.split(/\r?\n/).filter(Boolean)
      const counts = JSON.parse(lines[lines.length - 1])

      expect(counts.reads).toBeGreaterThan(200)
      expect(counts.empty).toBe(0)
      expect(counts.malformed).toBe(0)
      expect(counts.missing).toBe(0)
    },
    30_000
  )
})
