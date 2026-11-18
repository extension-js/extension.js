import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {sourceMayShip} from '../../html-lib/source-may-ship'

const canLink = process.platform !== 'win32'

let holder: string
let root: string
let extensionRoot: string

function write(relative: string, contents = 'x') {
  const target = path.join(holder, relative)
  fs.mkdirSync(path.dirname(target), {recursive: true})
  fs.writeFileSync(target, contents)

  return target
}

beforeAll(() => {
  holder = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-may-ship-'))
  )

  root = path.join(holder, 'project')
  extensionRoot = path.join(root, 'src')

  write('project/src/logo.png')
  write('project/src/.env')
  write('project/src/.env.example')
  write('project/src/.well-known/links.json')
  write('project/.git/config')
  write('project/node_modules/pkg/data.json')
  write('project/shared/logo.png')
  write('project/public/.env')
  write('project/public/.htaccess')
  write('design/logo.png')
  write('design/.npmrc')
  write('outside.txt')

  if (canLink) {
    fs.symlinkSync(
      path.join(holder, 'outside.txt'),
      path.join(extensionRoot, 'out.txt')
    )

    fs.symlinkSync(
      path.join(root, 'shared', 'logo.png'),
      path.join(extensionRoot, 'alias.png')
    )

    fs.symlinkSync(
      path.join(root, 'node_modules', 'pkg', 'data.json'),
      path.join(extensionRoot, 'installed.json')
    )

    fs.symlinkSync(
      path.join(extensionRoot, '.env'),
      path.join(extensionRoot, 'settings.txt')
    )
  }
})

afterAll(() => {
  fs.rmSync(holder, {recursive: true, force: true})
})

const ask = (
  relative: string,
  question?: {rootRef?: string; publicDir?: string}
) => sourceMayShip(path.join(holder, relative), root, extensionRoot, question)

describe('sourceMayShip', () => {
  it('ships project content, dot-named or not', () => {
    expect(ask('project/src/logo.png')).toEqual({ship: true})
    expect(ask('project/src/.env.example')).toEqual({ship: true})
    expect(ask('project/src/.well-known/links.json')).toEqual({ship: true})
    expect(ask('project/shared/logo.png')).toEqual({ship: true})
  })

  it('withholds a private name anywhere along the path', () => {
    const reason = {ship: false, reason: 'private-name'}

    expect(ask('project/src/.env')).toEqual(reason)
    expect(ask('project/src/.ENV')).toEqual(reason)
    expect(ask('project/.git/config')).toEqual(reason)
    expect(ask('design/.npmrc')).toEqual(reason)
    // Not on disk: the name alone decides.
    expect(ask('project/src/.env.local')).toEqual(reason)
  })

  it('withholds a file inside an installed package', () => {
    expect(ask('project/node_modules/pkg/data.json')).toEqual({
      ship: false,
      reason: 'installed-package'
    })
  })

  it('reads a root URL as the browser does', () => {
    const at = (rootRef: string) =>
      sourceMayShip(path.join(extensionRoot, 'logo.png'), root, extensionRoot, {
        rootRef
      })

    expect(at('/logo.png')).toEqual({ship: true})
    expect(at('/logo.png?v=2#top')).toEqual({ship: true})
    expect(at('/%2Eenv')).toEqual({ship: false, reason: 'private-name'})
    expect(at('/a/../.envrc')).toEqual({ship: false, reason: 'private-name'})
    expect(at('/../logo.png')).toEqual({ship: false, reason: 'climbs-out'})
    expect(at('/%2e%2e/logo.png')).toEqual({ship: false, reason: 'climbs-out'})
    expect(at('/a/../../logo.png')).toEqual({ship: false, reason: 'climbs-out'})
    expect(at('/node_modules/pkg/data.json')).toEqual({
      ship: false,
      reason: 'installed-package'
    })
  })

  it('withholds a root URL that is an address outside the project', () => {
    const outside = path.join(holder, 'outside.txt')

    expect(
      sourceMayShip(outside, root, extensionRoot, {rootRef: outside})
    ).toEqual({ship: false, reason: 'outside-project'})
  })

  it('takes an address inside the project as a file, not a root URL', () => {
    const inside = path.join(root, 'shared', 'logo.png')

    expect(
      sourceMayShip(inside, root, extensionRoot, {rootRef: inside})
    ).toEqual({ship: true})
  })

  it('ships a file outside the project that a relative path names', () => {
    expect(ask('design/logo.png')).toEqual({ship: true})
  })

  it.runIf(canLink)('follows a link to the file it names', () => {
    expect(ask('project/src/alias.png')).toEqual({ship: true})
    expect(ask('project/src/out.txt')).toEqual({
      ship: false,
      reason: 'outside-project'
    })

    expect(ask('project/src/installed.json')).toEqual({
      ship: false,
      reason: 'installed-package'
    })

    expect(ask('project/src/settings.txt')).toEqual({
      ship: false,
      reason: 'private-name'
    })
  })

  it('answers for public/ by name alone, as the copier does', () => {
    const publicDir = path.join(root, 'public')

    expect(ask('project/public/.htaccess', {publicDir})).toEqual({ship: true})
    expect(ask('project/public/.env', {publicDir})).toEqual({
      ship: false,
      reason: 'private-name'
    })
  })
})
