import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import type {TelemetryConsent, TelemetryEnv} from '../telemetry'
import {fsWith, useTelemetrySandbox} from './telemetry-sandbox'

const sandbox = useTelemetrySandbox()

const CI_MARKERS = [
  'CI',
  'GITHUB_ACTIONS',
  'GITLAB_CI',
  'BUILDKITE',
  'CIRCLECI',
  'TRAVIS'
]

interface Row {
  name: string
  env?: TelemetryEnv
  argv?: string[]
  // Whether a person watches stdout. Off by default, as in a pipeline.
  tty?: boolean
  // The raw text of the stored consent file, when there is one.
  stored?: string
  // A `.git` folder above the config home, as in a cloned repo.
  workTree?: boolean
  expected: TelemetryConsent
}

const DEFAULT: TelemetryConsent = {enabled: true, source: 'default'}
const BY_CI: TelemetryConsent = {enabled: false, source: 'ci'}
const ON_BY_ENV: TelemetryConsent = {
  enabled: true,
  source: 'env',
  variable: 'EXTENSION_TELEMETRY'
}
const OFF_BY_SWITCH: TelemetryConsent = {
  enabled: false,
  source: 'env',
  variable: 'EXTENSION_TELEMETRY_DISABLED'
}
const OFF_BY_OLD_SWITCH: TelemetryConsent = {
  enabled: false,
  source: 'env',
  variable: 'EXTENSION_TELEMETRY'
}
const OFF_BY_DO_NOT_TRACK: TelemetryConsent = {
  enabled: false,
  source: 'env',
  variable: 'DO_NOT_TRACK'
}
const OFF_BY_FLAG: TelemetryConsent = {enabled: false, source: 'flag'}
const ON_BY_FILE: TelemetryConsent = {enabled: true, source: 'config'}
const OFF_BY_FILE: TelemetryConsent = {enabled: false, source: 'config'}

const ROWS: Row[] = [
  {name: 'an ordinary interactive run stays on', expected: DEFAULT},
  ...CI_MARKERS.map((marker) => ({
    name: `a pipeline marked by ${marker} goes silent`,
    env: {[marker]: 'true'},
    expected: BY_CI
  })),
  // A devcontainer, Codespace or agent sandbox sets CI while a person watches
  // a terminal: 469 identities did so in the 90 days before this shipped.
  {
    name: 'CI with a person at a terminal keeps reporting',
    env: {CI: 'true'},
    tty: true,
    expected: DEFAULT
  },
  ...['1', 'true', 'on', 'yes', ' YES '].map((value) => ({
    name: `EXTENSION_TELEMETRY=${JSON.stringify(value)} opts in inside CI`,
    env: {CI: '1', EXTENSION_TELEMETRY: value},
    expected: ON_BY_ENV
  })),
  ...['0', 'false', 'off', 'no', ' Off '].map((value) => ({
    name: `EXTENSION_TELEMETRY=${JSON.stringify(value)} opts out`,
    env: {EXTENSION_TELEMETRY: value},
    expected: OFF_BY_OLD_SWITCH
  })),
  ...['1', 'true', 'on', 'yes'].map((value) => ({
    name: `EXTENSION_TELEMETRY_DISABLED=${value} opts out`,
    env: {EXTENSION_TELEMETRY_DISABLED: value},
    expected: OFF_BY_SWITCH
  })),
  // The consoledonottrack.com convention: set to anything but 0 or false.
  ...['1', 'true', 'yes', ' TRUE ', '2', 'anything'].map((value) => ({
    name: `DO_NOT_TRACK=${JSON.stringify(value)} opts out`,
    env: {DO_NOT_TRACK: value},
    expected: OFF_BY_DO_NOT_TRACK
  })),
  ...['', ' ', '0', 'false', ' False '].map((value) => ({
    name: `DO_NOT_TRACK=${JSON.stringify(value)} is no answer at all`,
    env: {DO_NOT_TRACK: value},
    expected: DEFAULT
  })),
  {
    name: 'DO_NOT_TRACK wins over an explicit enable',
    env: {CI: '1', EXTENSION_TELEMETRY: '1', DO_NOT_TRACK: '1'},
    expected: OFF_BY_DO_NOT_TRACK
  },
  {
    name: 'DO_NOT_TRACK beats a stored enabled',
    env: {DO_NOT_TRACK: '1'},
    stored: 'enabled',
    expected: OFF_BY_DO_NOT_TRACK
  },
  {
    name: 'the CLI switch is the one named when DO_NOT_TRACK is set too',
    env: {EXTENSION_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1'},
    expected: OFF_BY_SWITCH
  },
  {
    name: 'an unrecognized EXTENSION_TELEMETRY is no answer at all',
    env: {EXTENSION_TELEMETRY: 'maybe'},
    expected: DEFAULT
  },
  {
    name: 'EXTENSION_TELEMETRY_DISABLED=0 is not consent on its own',
    env: {CI: '1', EXTENSION_TELEMETRY_DISABLED: '0'},
    expected: BY_CI
  },
  {
    name: 'an explicit disable wins over an explicit enable',
    env: {CI: '1', EXTENSION_TELEMETRY: '1', EXTENSION_TELEMETRY_DISABLED: '1'},
    expected: OFF_BY_SWITCH
  },
  {
    name: '--no-telemetry wins over an explicit enable',
    env: {CI: '1', EXTENSION_TELEMETRY: '1'},
    argv: ['--no-telemetry'],
    expected: OFF_BY_FLAG
  },
  // Reproduced against published extension@4.0.24: a stored enabled sat above
  // the CI gate, so a pipeline on an inherited home reported as config.
  ...CI_MARKERS.map((marker) => ({
    name: `a stored enabled does not carry into a pipeline marked by ${marker}`,
    env: {[marker]: 'true'},
    stored: 'enabled',
    expected: BY_CI
  })),
  {
    name: 'a stored enabled works for the person who stored it',
    stored: 'enabled',
    expected: ON_BY_FILE
  },
  {
    name: 'a stored enabled works in CI with a person at a terminal',
    env: {CI: 'true'},
    tty: true,
    stored: 'enabled',
    expected: ON_BY_FILE
  },
  {
    name: 'a stored refusal wins in a pipeline and still says config',
    env: {CI: 'true'},
    stored: 'disabled',
    expected: OFF_BY_FILE
  },
  {
    name: 'the env opt-in beats both the gate and the file',
    env: {CI: 'true', EXTENSION_TELEMETRY: '1'},
    stored: 'enabled',
    expected: ON_BY_ENV
  },
  {
    name: 'an explicit disable beats a stored enabled',
    env: {EXTENSION_TELEMETRY_DISABLED: '1'},
    stored: 'enabled',
    expected: OFF_BY_SWITCH
  },
  {
    name: 'the flag beats a stored enabled',
    argv: ['--no-telemetry'],
    stored: 'enabled',
    expected: OFF_BY_FLAG
  },
  ...['ok', 'on', '1', ' ENABLED\n'].map((stored) => ({
    name: `a stored ${JSON.stringify(stored)} reads as enabled`,
    stored,
    expected: ON_BY_FILE
  })),
  ...['off', '0', 'no', 'Disabled\n'].map((stored) => ({
    name: `a stored ${JSON.stringify(stored)} reads as a refusal`,
    stored,
    expected: OFF_BY_FILE
  })),
  // A file that says neither is read as no file, so the notice shows again.
  ...['', 'yes please', '{"consent":true}', '\u0000\u0001'].map((stored) => ({
    name: `a corrupt stored ${JSON.stringify(stored)} reads as no answer`,
    stored,
    expected: DEFAULT
  })),
  {
    name: 'a corrupt stored file is still no answer in a pipeline',
    env: {CI: '1'},
    stored: 'garbage',
    expected: BY_CI
  },
  // Consent that arrived with a git clone is not this person's consent.
  {
    name: 'a stored enabled inside a worktree falls back to the notice',
    stored: 'ok',
    workTree: true,
    expected: DEFAULT
  },
  {
    name: 'a stored refusal inside a worktree is still honored',
    stored: 'disabled',
    workTree: true,
    expected: OFF_BY_FILE
  }
]

describe.each(ROWS)('telemetry consent: $name', (row) => {
  it('resolves to the expected answer and source', () => {
    const box = sandbox({
      env: row.env,
      deps: {stdoutIsTTY: () => Boolean(row.tty)}
    })

    if (row.stored !== undefined) {
      fs.mkdirSync(box.configDir, {recursive: true})
      fs.writeFileSync(path.join(box.configDir, 'consent'), row.stored)
    }

    if (row.workTree) fs.mkdirSync(path.join(box.root, '.git'))

    expect(box.kit().resolveConsent(row.argv ?? [])).toEqual(row.expected)
  })
})

describe('a consent file that cannot be read', () => {
  it('reads a folder where the file belongs as no answer', () => {
    const box = sandbox()

    fs.mkdirSync(path.join(box.configDir, 'consent'), {recursive: true})

    expect(box.kit().resolveConsent([])).toEqual(DEFAULT)
  })

  it('reads a file the reader refuses as no answer', () => {
    const box = sandbox({
      deps: {
        fs: fsWith({
          readFileSync: () => {
            throw Object.assign(new Error('EACCES'), {code: 'EACCES'})
          }
        })
      }
    })

    fs.mkdirSync(box.configDir, {recursive: true})
    fs.writeFileSync(path.join(box.configDir, 'consent'), 'disabled')

    // The stored refusal is unreadable, so the person is asked again.
    expect(box.kit().resolveConsent([])).toEqual(DEFAULT)
  })
})

describe('the CI detector', () => {
  it('is read from the env markers by default and only from them', () => {
    for (const marker of CI_MARKERS) {
      expect(
        sandbox({env: {[marker]: 'x'}})
          .kit()
          .deps.isCI(),
        marker
      ).toBe(true)
    }

    expect(sandbox().kit().deps.isCI()).toBe(false)
    expect(
      sandbox({env: {CI: ''}})
        .kit()
        .deps.isCI()
    ).toBe(false)
  })

  it('gates on the injected detector, not on the env it was built from', () => {
    const box = sandbox({env: {CI: '1'}, deps: {isCI: () => false}})

    expect(box.kit().resolveConsent([])).toEqual(DEFAULT)
  })
})
