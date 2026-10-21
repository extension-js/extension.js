import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
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
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-create-noname-'))

  return {
    work,
    result: spawnSync(process.execPath, [cliBin(), ...args], {
      cwd: work,
      encoding: 'utf8',
      env: {...process.env, EXTENSION_ENV: 'test', EXTENSION_TELEMETRY: '0'}
    })
  }
}

describe('create with no project name outside a terminal', () => {
  it('prints the exact command to copy and creates nothing', () => {
    const {work, result} = run(['create'])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('A project name is required.')
    expect(result.stderr).toContain(
      'npx extension@latest create my-extension --template=react'
    )

    expect(fs.readdirSync(work)).toEqual([])
  })

  it('keeps the template the caller passed in the command', () => {
    const {result} = run(['create', '--template', 'svelte'])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'npx extension@latest create my-extension --template=svelte'
    )
  })

  it('frames one usage envelope under --output json', () => {
    const {result} = run(['create', '--output', 'json'])

    expect(result.status).toBe(1)
    const frames = result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(frames).toHaveLength(1)
    expect(frames[0].status).toBe('usage')
    const error = frames[0].error as Record<string, unknown>
    expect(error.code).toBe('E_ARGS')
    expect(String(error.message)).toContain(
      'npx extension@latest create my-extension --template=react'
    )
  })
})
