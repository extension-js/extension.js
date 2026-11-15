import {spawnSync} from 'node:child_process'
import * as fs from 'node:fs'
import {createRequire} from 'node:module'
import os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'

const require = createRequire(__filename)

const developRoot = path.resolve(__dirname, '../..')
const manifestTypesFile = path.join(developRoot, 'lib', 'manifest-types.ts')
const created: string[] = []

function packageDir(specifier: string) {
  return path.dirname(require.resolve(`${specifier}/package.json`))
}

function linkDir(target: string, link: string) {
  fs.mkdirSync(path.dirname(link), {recursive: true})
  fs.symlinkSync(target, link, 'junction')
}

const manifestSource = `import type {Manifest, ManifestV2, ManifestV3} from './manifest-types'

export const v3: ManifestV3 = {
  manifest_version: 3,
  name: 'x',
  version: '1',
  action: {default_popup: 'popup.html'},
  background: {service_worker: 'sw.js', type: 'module'},
  permissions: ['tabs', 'sidePanel'],
  event_rules: [{conditions: [{pageUrl: {hostEquals: 'example.com'}}]}]
}

export const v2: ManifestV2 = {
  manifest_version: 2,
  name: 'x',
  version: '1',
  browser_action: {default_title: 'x'},
  permissions: ['tabs', 'https://example.com/*']
}

export const either: Manifest[] = [v2, v3]

export const refused: ManifestV3 = {
  manifest_version: 3,
  name: 'x',
  version: '1',
  // @ts-expect-error a Manifest V3 permission is one of the known names
  permissions: ['not-a-permission']
}
`

// The index signature is set aside first, or it would hide a key that
// only one side declares.
const sameShapeSource = `import type {ManifestV2, ManifestV3} from './manifest-types'

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

type Known<T> = {
  [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K]
}

type Local2 = Known<ManifestV2>
type Local3 = Known<ManifestV3>
type Theirs2 = Known<chrome.runtime.ManifestV2>
type Theirs3 = Known<chrome.runtime.ManifestV3>

export const sameKeysV2: Same<keyof Local2, keyof Theirs2> = true
export const sameKeysV3: Same<keyof Local3, keyof Theirs3> = true
export const sameV2: Same<Local2, Theirs2> = true
export const sameV3: Same<Local3, Theirs3> = true
`

type ChromeTypesSource = 'none' | 'chrome-types' | '@types/chrome'

function typecheckManifestTypes(source: ChromeTypesSource) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-manifest-types-'))
  const files = ['manifest-types.ts', 'manifest.ts']

  created.push(root)
  fs.copyFileSync(manifestTypesFile, path.join(root, 'manifest-types.ts'))
  fs.writeFileSync(path.join(root, 'manifest.ts'), manifestSource)

  if (source === 'chrome-types') {
    linkDir(
      packageDir('chrome-types'),
      path.join(root, 'node_modules', 'chrome-types')
    )
  }

  if (source === '@types/chrome') {
    linkDir(
      packageDir('@types/chrome'),
      path.join(root, 'node_modules', '@types', 'chrome')
    )

    fs.writeFileSync(path.join(root, 'same-shape.ts'), sameShapeSource)
    files.push('same-shape.ts')
  }

  fs.writeFileSync(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        module: 'esnext',
        target: 'esnext',
        moduleResolution: 'bundler',
        lib: ['dom', 'esnext'],
        noEmit: true,
        skipLibCheck: true,
        types:
          source === 'none'
            ? []
            : [source === '@types/chrome' ? 'chrome' : source]
      },
      files
    })
  )

  const run = spawnSync(
    process.execPath,
    [
      path.join(packageDir('typescript'), 'bin', 'tsc'),
      '-p',
      root,
      '--pretty',
      'false',
      '--listFiles'
    ],
    {cwd: root, encoding: 'utf8'}
  )

  return {
    status: run.status,
    output: `${run.stdout}\n${run.stderr}`,
    errors: run.stdout.split('\n').filter((line) => line.includes('error TS')),
    files: run.stdout.split('\n').map((file) => file.trim())
  }
}

afterEach(() => {
  for (const dir of created) {
    fs.rmSync(dir, {recursive: true, force: true})
  }

  created.length = 0
})

describe('the manifest types the published declarations use', () => {
  // The published declarations reach a project that loads chrome-types, one
  // that loads @types/chrome and one that loads neither.
  it('stands alone, with no import and no extension API global', () => {
    const source = fs.readFileSync(manifestTypesFile, 'utf8')

    expect(source).not.toMatch(/^\s*import\s/m)
    expect(source).not.toMatch(/\b(?:chrome|browser)\.[A-Za-z]+\.[A-Za-z]/)
  })

  it('typechecks with no Chrome types package loaded', () => {
    const result = typecheckManifestTypes('none')

    expect(result.errors).toEqual([])
    expect(result.status).toBe(0)
  })

  it('typechecks beside chrome-types, which has no manifest types', () => {
    const result = typecheckManifestTypes('chrome-types')

    expect(result.errors).toEqual([])
    expect(result.status).toBe(0)
    expect(
      result.files.some((file) => /chrome-types[\\/]index\.d\.ts$/.test(file))
    ).toBe(true)
  })

  it('has the same shape as the @types/chrome manifest types it was copied from', () => {
    const result = typecheckManifestTypes('@types/chrome')

    expect(result.errors).toEqual([])
    expect(result.status).toBe(0)
    expect(
      result.files.some((file) => /@types[\\/]chrome[\\/]/.test(file))
    ).toBe(true)
  })
})
