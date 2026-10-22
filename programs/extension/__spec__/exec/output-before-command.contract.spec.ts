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

describe('--output in front of the command', () => {
  for (const args of [
    ['--output', 'json', 'capabilities'],
    ['--output=json', 'capabilities']
  ]) {
    it(`is honored like its deprecated alias: ${args.join(' ')}`, () => {
      const result = run(args)

      expect(result.status).toBe(0)
      const frame = JSON.parse(result.stdout.trim()) as Record<string, unknown>
      expect(frame.schema).toBe(1)
      expect(frame.command).toBe('capabilities')
      expect(frame.ok).toBe(true)
    })
  }
})

describe('verbs other scaffolders use', () => {
  it('names create when the verb is init', () => {
    const result = run(['init'])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Unknown command init.')
    expect(result.stderr).toContain(
      'Run extension create my-extension to start a new extension.'
    )
  })
})
