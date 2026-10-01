import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {describe, expect, it} from 'vitest'

function cliRoot(): string {
  return path.resolve(__dirname, '..')
}

function cliBin(): string {
  const cjs = path.join(cliRoot(), 'dist', 'cli.cjs')
  if (fs.existsSync(cjs)) return cjs

  return path.join(cliRoot(), 'dist', 'cli.js')
}

const NOTICE = 'collects anonymous, opt-out telemetry'

function telemetryStatus(home: string): {stdout: string; stderr: string} {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    POSTHOG_HOST: 'http://127.0.0.1:1',
    XDG_CONFIG_HOME: home,
    XDG_CACHE_HOME: home
  }

  // The notice gate is the `default` source, so every env that resolves the
  // consent before it, a CI marker included, has to be out of the way.
  for (const key of [
    'CI',
    'GITHUB_ACTIONS',
    'GITLAB_CI',
    'BUILDKITE',
    'CIRCLECI',
    'TRAVIS',
    'EXTENSION_TELEMETRY',
    'EXTENSION_TELEMETRY_DISABLED'
  ]) {
    delete env[key]
  }

  const result = spawnSync(
    process.execPath,
    [cliBin(), 'telemetry', 'status'],
    {
      cwd: home,
      encoding: 'utf8',
      env
    }
  )

  return {stdout: result.stdout ?? '', stderr: result.stderr ?? ''}
}

function makeHome(insideWorkTree: boolean): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-notice-'))
  if (insideWorkTree) fs.mkdirSync(path.join(home, '.git'), {recursive: true})

  return home
}

describe('the first-run notice prints once per machine', () => {
  it('prints it once with a state dir inside a git worktree', () => {
    const base = makeHome(true)

    const first = telemetryStatus(base)
    const second = telemetryStatus(base)

    expect(first.stderr).toContain(NOTICE)
    expect(second.stderr).not.toContain(NOTICE)

    // Consent that came with a checkout still grants nothing, so the source
    // stays `default` on both runs: only the repeated notice was the defect.
    expect(first.stdout).toContain('enabled (source: default)')
    expect(second.stdout).toContain('enabled (source: default)')
  }, 120000)

  it('prints it once with a state dir outside any worktree', () => {
    const base = makeHome(false)

    const first = telemetryStatus(base)
    const second = telemetryStatus(base)

    expect(first.stderr).toContain(NOTICE)
    expect(second.stderr).not.toContain(NOTICE)
    expect(first.stdout).toContain('enabled (source: default)')
    expect(second.stdout).toContain('enabled (source: config)')
  }, 120000)
})
