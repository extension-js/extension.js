import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {
  asAskedPath,
  collapseHomeDir,
  displayPath,
  rememberAskedPath
} from '../paths'
import {getProjectStructure} from '../project'

const tempFolder = trackTempFolders()
const real = path.resolve('/work/real/project')
const asked = path.resolve('/links/project')

afterEach(() => {
  rememberAskedPath(real, real)
})

describe('the path a command was given for a linked project', () => {
  it('comes back for the project folder and anything below it', () => {
    rememberAskedPath(asked, real)

    expect(asAskedPath(real)).toBe(asked)
    expect(asAskedPath(path.join(real, 'dist', 'chrome'))).toBe(
      path.join(asked, 'dist', 'chrome')
    )
  })

  it('leaves a neighbor that only shares the first letters as it is', () => {
    rememberAskedPath(asked, real)

    expect(asAskedPath(`${real}-two`)).toBe(`${real}-two`)
    expect(asAskedPath(path.dirname(real))).toBe(path.dirname(real))
  })

  it('forgets the project once it is named by its real path', () => {
    rememberAskedPath(asked, real)
    rememberAskedPath(real, real)

    expect(asAskedPath(path.join(real, 'dist'))).toBe(path.join(real, 'dist'))
  })

  it('answers with the deepest project when one sits inside another', () => {
    const inner = path.join(real, 'packages', 'inner')
    const innerAsked = path.resolve('/links/inner')

    rememberAskedPath(asked, real)
    rememberAskedPath(innerAsked, inner)

    expect(asAskedPath(path.join(inner, 'dist'))).toBe(
      path.join(innerAsked, 'dist')
    )

    rememberAskedPath(inner, inner)
  })

  it('is what a printed path shows', () => {
    rememberAskedPath(asked, real)

    const dist = path.join(real, 'dist', 'chrome')

    expect(collapseHomeDir(dist)).toBe(path.join(asked, 'dist', 'chrome'))
    expect(displayPath(dist, path.resolve('/elsewhere'))).toBe(
      path.join(asked, 'dist', 'chrome')
    )

    expect(displayPath(dist, path.dirname(asked))).toBe(
      path.join('project', 'dist', 'chrome')
    )

    // From inside the real folder the short relative form still wins.
    expect(displayPath(dist, real)).toBe(path.join('dist', 'chrome'))
  })
})

function canLink(): boolean {
  const probe = tempFolder('extjs-asked-link-probe-')

  try {
    fs.mkdirSync(path.join(probe, 'target'))
    fs.symlinkSync(path.join(probe, 'target'), path.join(probe, 'link'), 'dir')

    return true
  } catch {
    return false
  }
}

describe.skipIf(!canLink())('getProjectStructure for a linked project', () => {
  it('resolves the project by its real path and remembers the link', async () => {
    const base = fs.realpathSync(tempFolder('extjs-asked-link-'))
    const project = path.join(base, 'real')
    const link = path.join(base, 'link')

    fs.mkdirSync(project)
    fs.writeFileSync(path.join(project, 'manifest.json'), '{}')
    fs.writeFileSync(
      path.join(project, 'package.json'),
      JSON.stringify({name: 'linked'})
    )

    fs.symlinkSync(project, link, 'dir')

    const structure = await getProjectStructure(link)

    expect(structure.manifestPath).toBe(path.join(project, 'manifest.json'))
    expect(structure.packageJsonPath).toBe(path.join(project, 'package.json'))
    expect(asAskedPath(path.join(project, 'dist'))).toBe(
      path.join(link, 'dist')
    )

    await getProjectStructure(project)

    expect(asAskedPath(path.join(project, 'dist'))).toBe(
      path.join(project, 'dist')
    )
  })
})
