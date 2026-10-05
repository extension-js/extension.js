import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {resolveProjectStructureSync} from '../../../develop/lib/project'
import {internalErrorEnvelope} from '../../helpers/cli-failure'
import {CODES} from '../../helpers/messaging'

const temps: string[] = []

function makeProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-codes-'))
  temps.push(dir)

  return dir
}

function write(file: string, body: unknown): void {
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, JSON.stringify(body))
}

function resolutionEnvelope(projectPath: string) {
  try {
    resolveProjectStructureSync(projectPath, {quiet: true})
  } catch (error) {
    return internalErrorEnvelope(error, 'build')
  }

  throw new Error(`${projectPath} resolved instead of refusing`)
}

afterAll(() => {
  for (const dir of temps) {
    try {
      fs.rmSync(dir, {recursive: true, force: true})
    } catch {
      // Ignore
    }
  }
})

describe('project resolution refusals carry their declared code', () => {
  it('declares every code this spec asserts', () => {
    for (const code of [
      CODES.E_PROJECT_NOT_FOUND,
      CODES.E_MANIFEST_NOT_FOUND,
      CODES.E_MANIFEST_INVALID,
      CODES.E_MANIFEST_IN_PUBLIC,
      CODES.E_COMPANION_EXTENSION_PATH
    ]) {
      expect(Object.prototype.hasOwnProperty.call(CODES, code)).toBe(true)
    }
  })

  it('names a project folder that does not exist', () => {
    const missing = path.join(makeProject(), 'nowhere')

    expect(resolutionEnvelope(missing).error?.code).toBe(
      CODES.E_PROJECT_NOT_FOUND
    )
  })

  it('names a project folder that holds no manifest', () => {
    const project = makeProject()
    write(path.join(project, 'package.json'), {name: 'p'})

    expect(resolutionEnvelope(project).error?.code).toBe(
      CODES.E_MANIFEST_NOT_FOUND
    )
  })

  it('names a manifest that is not a WebExtension manifest', () => {
    const project = makeProject()
    write(path.join(project, 'package.json'), {name: 'p'})
    write(path.join(project, 'manifest.json'), {
      name: 'a web app',
      start_url: '/',
      display: 'standalone'
    })

    expect(resolutionEnvelope(project).error?.code).toBe(
      CODES.E_MANIFEST_INVALID
    )
  })

  it('names a manifest that lives under public', () => {
    const root = makeProject()
    write(path.join(root, 'package.json'), {name: 'p'})
    write(path.join(root, 'public', 'manifest.json'), {
      manifest_version: 3,
      name: 'in public',
      version: '1.0'
    })

    expect(resolutionEnvelope(path.join(root, 'public')).error?.code).toBe(
      CODES.E_MANIFEST_IN_PUBLIC
    )
  })

  it('names a root whose only manifest belongs to a companion', () => {
    const project = makeProject()
    write(path.join(project, 'package.json'), {name: 'p'})
    write(
      path.join(
        project,
        'extensions',
        'extension-js-devtools',
        'manifest.json'
      ),
      {manifest_version: 3, name: 'built-in companion', version: '1.0'}
    )

    expect(resolutionEnvelope(project).error?.code).toBe(
      CODES.E_COMPANION_EXTENSION_PATH
    )
  })

  it('keeps an uncoded failure on the internal-error code', () => {
    const envelope = internalErrorEnvelope(
      new Error('something broke'),
      'build'
    )

    expect(envelope.error?.code).toBe(CODES.E_INTERNAL)
  })

  it('ignores an errno code that is not a declared failure class', () => {
    const errno = Object.assign(new Error('no such file'), {code: 'ENOENT'})

    expect(internalErrorEnvelope(errno, 'build').error?.code).toBe(
      CODES.E_INTERNAL
    )
  })
})
