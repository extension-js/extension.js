import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {describe, expect, it} from 'vitest'

function cliRoot(): string {
  return path.resolve(__dirname, '../..')
}

function cliBin(): string {
  const cjs = path.join(cliRoot(), 'dist', 'cli.cjs')
  if (fs.existsSync(cjs)) return cjs
  return path.join(cliRoot(), 'dist', 'cli.js')
}

function run(args: string[]) {
  return spawnSync(process.execPath, [cliBin(), ...args], {
    cwd: cliRoot(),
    encoding: 'utf8',
    env: {
      ...process.env,
      EXTENSION_ENV: 'test',
      EXTENSION_TELEMETRY_DISABLED: '1'
    }
  })
}

// --format is documented as a deprecated alias of --output that still works and
// warns once on stderr. Only the root program declared it, for --ai-help, so on
// a subcommand commander accepted it and no command ever read it: the run
// printed human output while the caller waited for an envelope, with no signal.
describe('the deprecated --format alias', () => {
  it('resolves to --output on a subcommand', () => {
    const aliased = run(['capabilities', '--format', 'json'])
    expect(aliased.status).toBe(0)

    const parsed = JSON.parse(aliased.stdout.trim())
    expect(parsed.command).toBe('capabilities')
    expect(parsed.schema).toBe(1)
  })

  it('accepts the --format=json form too', () => {
    const aliased = run(['capabilities', '--format=json'])
    expect(aliased.status).toBe(0)
    expect(JSON.parse(aliased.stdout.trim()).command).toBe('capabilities')
  })

  it('warns on stderr so stdout stays a parseable document', () => {
    const aliased = run(['capabilities', '--format', 'json'])
    expect(aliased.stderr.toLowerCase()).toContain('deprecated')
    // The notice must never land on stdout: one JSON document, nothing else.
    expect(() => JSON.parse(aliased.stdout.trim())).not.toThrow()
  })

  it('leaves a genuinely unknown flag failing', () => {
    const unknown = run(['capabilities', '--not-a-real-flag'])
    expect(unknown.status).not.toBe(0)
    expect(unknown.stderr).toContain('Unknown option')
  })
})
