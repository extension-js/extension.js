import fs from 'node:fs'
import {describe, expect, it} from 'vitest'
import {everyLineAsFrame, runCli} from '../helpers/run-cli'
import {trackTempFolders} from '../helpers/temp-folders'

const makeTempFolder = trackTempFolders()

async function run(args: string[]) {
  const work = makeTempFolder('extjs-create-noname-')

  return {work, result: await runCli(args, {cwd: work})}
}

describe('create with no project name outside a terminal', () => {
  it('prints the exact command to copy and creates nothing', async () => {
    const {work, result} = await run(['create'])

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe(
      '⏵⏵⏵ Error: A project name is required.\n' +
        'Run npx extension@latest create my-extension --template=react to start one.\n'
    )

    expect(fs.readdirSync(work)).toEqual([])
  })

  it('keeps the template the caller passed in the command', async () => {
    const {work, result} = await run(['create', '--template', 'svelte'])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'npx extension@latest create my-extension --template=svelte'
    )

    expect(fs.readdirSync(work)).toEqual([])
  })

  it('frames one usage envelope under --output json', async () => {
    const {work, result} = await run(['create', '--output', 'json'])

    expect(result.status).toBe(1)

    const frames = everyLineAsFrame(result.stdout)

    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({
      ok: false,
      command: 'create',
      status: 'usage'
    })

    const error = frames[0].error as Record<string, unknown>

    expect(error.code).toBe('E_ARGS')
    expect(String(error.message)).toContain(
      'npx extension@latest create my-extension --template=react'
    )

    expect(fs.readdirSync(work)).toEqual([])
  })
})
