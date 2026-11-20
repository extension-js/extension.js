import fs from 'node:fs'
import path from 'node:path'
import {describe, expect, it} from 'vitest'
import {everyLineAsFrame, freshCliHome, runCli} from '../helpers/run-cli'
import {trackTempFolders} from '../helpers/temp-folders'

const makeTempFolder = trackTempFolders()

function create(name: string) {
  const work = makeTempFolder('extjs-create-pkgname-')

  return {
    work,
    result: runCli(
      ['create', name, '--template', 'javascript', '--output', 'json'],
      {cwd: work, home: freshCliHome()}
    )
  }
}

// The folder keeps what was typed, and package.json gets a name npm takes.
describe('create with a folder name npm refuses as a package name', () => {
  it('derives one, says so, and answers it in the envelope', async () => {
    const {work, result} = create('bad name!')
    const {status, stdout, stderr} = await result

    expect(status, stderr).toBe(0)

    const frames = everyLineAsFrame(stdout)
    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({
      ok: true,
      status: 'created',
      value: {projectName: 'bad name!', packageName: 'bad-name'}
    })

    const packageJson = JSON.parse(
      fs.readFileSync(path.join(work, 'bad name!', 'package.json'), 'utf8')
    )
    expect(packageJson.name).toBe('bad-name')
    expect(stderr).toContain(
      'package.json names it bad-name, because npm refuses "bad name!" as a package name.'
    )
  }, 120000)

  it('refuses one it cannot derive with E_ARGS and creates nothing', async () => {
    const {work, result} = create('node_modules')
    const {status, stdout} = await result

    expect(status).toBe(1)

    const frames = everyLineAsFrame(stdout)
    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({ok: false, status: 'failed'})
    expect((frames[0].error as Record<string, unknown>).code).toBe('E_ARGS')
    expect(
      String((frames[0].error as Record<string, unknown>).message)
    ).toContain(
      '"node_modules" can\'t be a package name: npm reserves that name.'
    )

    expect(fs.readdirSync(work)).toEqual([])
  }, 120000)
})
