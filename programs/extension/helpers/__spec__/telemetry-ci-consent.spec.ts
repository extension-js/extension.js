import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {resolveTelemetryConsent} from '../telemetry'

const originalEnv = {...process.env}

const CI_VARS = [
  'CI',
  'GITHUB_ACTIONS',
  'GITLAB_CI',
  'BUILDKITE',
  'CIRCLECI',
  'TRAVIS'
]

const TELEMETRY_VARS = [
  'EXTENSION_TELEMETRY',
  'EXTENSION_TELEMETRY_DISABLED',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME'
]

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key]
  }
  for (const [key, value] of Object.entries(originalEnv)) {
    process.env[key] = value
  }
}

beforeEach(() => {
  for (const key of [...CI_VARS, ...TELEMETRY_VARS]) delete process.env[key]
  // An isolated, empty config home so no developer's real consent file leaks in.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-ci-consent-'))
  process.env.XDG_CONFIG_HOME = home
  process.env.XDG_CACHE_HOME = home
})

afterEach(restoreEnv)

describe('a machine is not a developer who agreed to be measured', () => {
  it('stays on for an ordinary interactive run', () => {
    expect(resolveTelemetryConsent([])).toEqual({
      enabled: true,
      source: 'default'
    })
  })

  it.each(CI_VARS)('goes silent under %s', (marker) => {
    process.env[marker] = 'true'
    expect(resolveTelemetryConsent([])).toEqual({enabled: false, source: 'ci'})
  })

  // A pipeline has no TTY and cannot be shown the first-run notice, so it never
  // agreed. A devcontainer, Codespace or agent sandbox sets CI too, but there is
  // a person at a terminal, and 469 identities in the 90 days before this shipped
  // carried a CI marker while running dev, start or preview, which no pipeline
  // does. Gating on the marker alone silenced all of them.
  it('keeps reporting when CI is set but a person has a terminal', () => {
    const saved = process.stdout.isTTY
    try {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: true,
        configurable: true
      })
      for (const marker of CI_VARS) {
        delete process.env[marker]
      }
      process.env.CI = 'true'
      expect(resolveTelemetryConsent([])).toEqual({
        enabled: true,
        source: 'default'
      })
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: saved,
        configurable: true
      })
    }
  })

  it('still goes silent when CI is set and nothing is attached to stdout', () => {
    const saved = process.stdout.isTTY
    try {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: false,
        configurable: true
      })
      process.env.CI = 'true'
      expect(resolveTelemetryConsent([])).toEqual({
        enabled: false,
        source: 'ci'
      })
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: saved,
        configurable: true
      })
    }
  })

  it('reports ci rather than default, so the reason is legible', () => {
    process.env.GITHUB_ACTIONS = 'true'
    expect(resolveTelemetryConsent([]).source).toBe('ci')
  })

  it('still honours an explicit opt-in inside CI, which the smoke job needs', () => {
    process.env.CI = '1'
    for (const value of ['1', 'true', 'on', 'yes']) {
      process.env.EXTENSION_TELEMETRY = value
      expect(resolveTelemetryConsent([]), value).toEqual({
        enabled: true,
        source: 'env'
      })
    }
  })

  it('lets an explicit disable win over an explicit enable', () => {
    process.env.CI = '1'
    process.env.EXTENSION_TELEMETRY = '1'
    process.env.EXTENSION_TELEMETRY_DISABLED = '1'
    expect(resolveTelemetryConsent([])).toEqual({enabled: false, source: 'env'})
  })

  it('lets --no-telemetry win over an explicit enable', () => {
    process.env.CI = '1'
    process.env.EXTENSION_TELEMETRY = '1'
    expect(resolveTelemetryConsent(['--no-telemetry'])).toEqual({
      enabled: false,
      source: 'flag'
    })
  })

  it('does not treat EXTENSION_TELEMETRY_DISABLED=0 as consent on its own', () => {
    process.env.CI = '1'
    process.env.EXTENSION_TELEMETRY_DISABLED = '0'
    expect(resolveTelemetryConsent([])).toEqual({enabled: false, source: 'ci'})
  })
})

/* @invariant Reproduced against published extension@4.0.24 before it was fixed:
 * one ordinary run persists `enabled` through the first-run notice, and a second
 * run on that same home under CI answered `enabled (source: config)` because the
 * stored branch sat above the gate. A control on a fresh home answered
 * `disabled`, so the gate worked and only the ordering was wrong. Every case
 * below fails on that ordering.
 */
describe('a home directory a pipeline inherited did not agree to anything', () => {
  function storeConsent(value: 'enabled' | 'disabled') {
    const dir = path.join(
      process.env.XDG_CONFIG_HOME as string,
      'extensionjs',
      'telemetry'
    )
    fs.mkdirSync(dir, {recursive: true})
    fs.writeFileSync(path.join(dir, 'consent'), value, 'utf8')
  }

  function withoutTty(run: () => void) {
    const saved = process.stdout.isTTY
    try {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: false,
        configurable: true
      })
      run()
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: saved,
        configurable: true
      })
    }
  }

  it('does not let a stored enabled carry a person s consent into CI', () => {
    storeConsent('enabled')
    expect(resolveTelemetryConsent([])).toEqual({
      enabled: true,
      source: 'config'
    })
    withoutTty(() => {
      for (const marker of CI_VARS) {
        delete process.env[marker]
        process.env[marker] = 'true'
        expect(resolveTelemetryConsent([]), marker).toEqual({
          enabled: false,
          source: 'ci'
        })
        delete process.env[marker]
      }
    })
  })

  it('keeps a stored enabled working for the person who stored it', () => {
    storeConsent('enabled')
    const saved = process.stdout.isTTY
    try {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: true,
        configurable: true
      })
      process.env.CI = 'true'
      expect(resolveTelemetryConsent([])).toEqual({
        enabled: true,
        source: 'config'
      })
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: saved,
        configurable: true
      })
    }
  })

  it('keeps a stored refusal winning, and still calls it config', () => {
    storeConsent('disabled')
    withoutTty(() => {
      process.env.CI = 'true'
      expect(resolveTelemetryConsent([])).toEqual({
        enabled: false,
        source: 'config'
      })
    })
  })

  it('lets the explicit env opt-in beat both the gate and the file', () => {
    storeConsent('enabled')
    withoutTty(() => {
      process.env.CI = 'true'
      process.env.EXTENSION_TELEMETRY = '1'
      expect(resolveTelemetryConsent([])).toEqual({
        enabled: true,
        source: 'env'
      })
    })
  })

  it('lets an explicit disable and the flag beat a stored enabled', () => {
    storeConsent('enabled')
    process.env.EXTENSION_TELEMETRY_DISABLED = '1'
    expect(resolveTelemetryConsent([])).toEqual({enabled: false, source: 'env'})
    delete process.env.EXTENSION_TELEMETRY_DISABLED
    expect(resolveTelemetryConsent(['--no-telemetry'])).toEqual({
      enabled: false,
      source: 'flag'
    })
  })
})
