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
    env: {...process.env, EXTENSION_ENV: 'test'}
  })
}

function stdoutFrames(stdout: string): Array<Record<string, unknown>> {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

describe('pre-command failures under --output json', () => {
  it('frames an unknown command as one schema-1 envelope on stdout', () => {
    const result = run(['nonexistent-cmd', '--output', 'json'])

    expect(result.status).toBe(1)
    const frames = stdoutFrames(result.stdout)
    expect(frames).toHaveLength(1)
    const frame = frames[0]
    expect(frame.schema).toBe(1)
    expect(frame.ok).toBe(false)
    expect(frame.status).toBe('usage')
    const error = frame.error as Record<string, unknown>
    expect(error.code).toBe('E_UNKNOWN_COMMAND')
    expect(error.refs).toEqual({command: 'nonexistent-cmd'})
    expect(result.stderr).toContain("unknown command 'nonexistent-cmd'")
  })

  it('frames an unknown option with the flag carried as a ref', () => {
    const result = run(['dev', '--nope', '--output', 'json'])

    expect(result.status).toBe(1)
    const frames = stdoutFrames(result.stdout)
    expect(frames).toHaveLength(1)
    const error = frames[0].error as Record<string, unknown>
    expect(error.code).toBe('E_FLAG_NOT_SUPPORTED_HERE')
    expect(error.refs).toEqual({flag: '--nope'})
    expect(result.stderr).toContain("unknown option '--nope'")
  })

  it('frames a missing required argument', () => {
    const result = run(['eval', '--output', 'json'])

    expect(result.status).toBe(1)
    const frames = stdoutFrames(result.stdout)
    expect(frames).toHaveLength(1)
    const error = frames[0].error as Record<string, unknown>
    expect(error.code).toBe('E_ARGS')
  })

  it('frames a pre-parse removed-flag refusal', () => {
    const result = run(['build', '--no-runner', '--output', 'json'])

    expect(result.status).toBe(1)
    const frames = stdoutFrames(result.stdout)
    expect(frames).toHaveLength(1)
    const error = frames[0].error as Record<string, unknown>
    expect(error.code).toBe('E_REMOVED_FLAG')
    expect(error.refs).toEqual({flag: '--no-runner'})
  })

  it('keeps stdout prose-only without --output json', () => {
    const result = run(['nonexistent-cmd'])

    expect(result.status).toBe(1)
    expect(result.stdout).not.toContain('"schema":1')
  })

  it('keeps --help and --version on exit 0 with no envelope', () => {
    const help = run(['--help'])
    expect(help.status).toBe(0)
    expect(help.stdout).toContain('Usage:')

    const version = run(['--version'])
    expect(version.status).toBe(0)
    expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/)
  })
})
