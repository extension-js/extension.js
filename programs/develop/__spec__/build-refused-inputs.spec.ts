import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {buildProject} from './helpers/build-project'
import {writeExtensionProject} from './helpers/extension-project'
import {trackTempFolders} from './helpers/temp-folders'

const makeTempFolder = trackTempFolders()

function project() {
  const root = makeTempFolder('extjs-refused-inputs-')

  writeExtensionProject(root, {
    name: 'refused-inputs',
    manifest: {background: {service_worker: 'background.js'}}
  })

  fs.writeFileSync(path.join(root, 'background.js'), 'console.log("bg")\n')

  return root
}

async function failureOf(run: Promise<unknown>) {
  try {
    await run
  } catch (error) {
    return error as Error & {code?: string}
  }

  throw new Error('the build resolved')
}

describe('a build given an input it cannot use', () => {
  it('refuses an unknown browser with its code and writes no dist', async () => {
    const root = project()
    const error = await failureOf(buildProject(root, {browser: 'netscape'}))

    expect(error.code).toBe('E_UNSUPPORTED_BROWSER')
    expect(error.message).toContain('netscape')
    expect(fs.existsSync(path.join(root, 'dist'))).toBe(false)
  })

  it('fails with a code when the output folder cannot be written', async () => {
    const root = project()
    // A file where the output folder goes blocks it on every platform.
    fs.writeFileSync(path.join(root, 'dist'), 'not a folder\n')

    const error = await failureOf(buildProject(root))

    expect(error.code).toMatch(/^E_[A-Z_]+$/)
    expect(error.code).not.toBe('E_INTERNAL')
    expect(fs.readFileSync(path.join(root, 'dist'), 'utf8')).toBe(
      'not a folder\n'
    )
  })
})
