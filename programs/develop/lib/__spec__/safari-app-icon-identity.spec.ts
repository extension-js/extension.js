import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {resolveSafariIdentity} from '../safari-identity'

let project: string

beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-safari-identity-'))
  fs.mkdirSync(path.join(project, 'store'), {recursive: true})
  fs.writeFileSync(path.join(project, 'store', 'app-icon.png'), 'png')
})

afterEach(() => {
  fs.rmSync(project, {recursive: true, force: true})
})

describe('the Safari appIcon option', () => {
  it('reads a relative path from the project, not the working directory', () => {
    const identity = resolveSafariIdentity(
      {appIcon: 'store/app-icon.png'},
      project
    )

    expect(identity.appIcon).toBe(path.join(project, 'store', 'app-icon.png'))
  })

  it('refuses a path that names no file before anything builds', () => {
    expect(() =>
      resolveSafariIdentity({appIcon: 'store/missing.png'}, project)
    ).toThrow(path.join(project, 'store', 'missing.png'))
  })

  it('stays unset when the option is not given', () => {
    expect(resolveSafariIdentity({}, project).appIcon).toBeUndefined()
  })
})
