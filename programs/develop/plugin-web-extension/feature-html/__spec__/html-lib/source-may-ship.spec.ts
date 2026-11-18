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
    expect(ask('project/src/logo.png')).toBe(true)
    expect(ask('project/src/.env.example')).toBe(true)
    expect(ask('project/src/.well-known/links.json')).toBe(true)
    expect(ask('project/shared/logo.png')).toBe(true)
  })

  it('withholds a private name anywhere along the path', () => {
    expect(ask('project/src/.env')).toBe(false)
    expect(ask('project/src/.ENV')).toBe(false)
    expect(ask('project/.git/config')).toBe(false)
    expect(ask('design/.npmrc')).toBe(false)
    // A file that is not there is not shipped either.
    expect(ask('project/src/nothing.png')).toBe(false)
  })

  it('withholds a file inside an installed package', () => {
    expect(ask('project/node_modules/pkg/data.json')).toBe(false)
  })

  it('reads a root URL as the browser does', () => {
    const at = (rootRef: string) =>
      sourceMayShip(path.join(extensionRoot, 'logo.png'), root, extensionRoot, {
        rootRef
      })

    expect(at('/logo.png')).toBe(true)
    expect(at('/logo.png?v=2#top')).toBe(true)
    expect(at('/%2Eenv')).toBe(false)
    expect(at('/a/../.envrc')).toBe(false)
    expect(at('/../logo.png')).toBe(false)
    expect(at('/%2e%2e/logo.png')).toBe(false)
    expect(at('/a/../../logo.png')).toBe(false)
  })

  it('withholds a root URL that is an address outside the project', () => {
    const outside = path.join(holder, 'outside.txt')

    expect(
      sourceMayShip(outside, root, extensionRoot, {rootRef: outside})
    ).toBe(false)
  })

  it('takes an address inside the project as a file, not a root URL', () => {
    const inside = path.join(root, 'shared', 'logo.png')

    expect(sourceMayShip(inside, root, extensionRoot, {rootRef: inside})).toBe(
      true
    )
  })

  it('withholds a file outside the project, however it is named', () => {
    expect(ask('design/logo.png')).toBe(false)
  })

  it.runIf(canLink)('follows a link to the file it names', () => {
    expect(ask('project/src/alias.png')).toBe(true)
    expect(ask('project/src/out.txt')).toBe(false)

    expect(ask('project/src/installed.json')).toBe(false)

    expect(ask('project/src/settings.txt')).toBe(false)
  })

  it('answers for public/ by name alone, as the copier does', () => {
    const publicDir = path.join(root, 'public')

    expect(ask('project/public/.htaccess', {publicDir})).toBe(true)
    expect(ask('project/public/.env', {publicDir})).toBe(false)
    // A private name in the reference is asked before the folder answers.
    expect(
      ask('project/public/.htaccess', {publicDir, rootRef: '/%2Eenv'})
    ).toBe(false)
  })
})
