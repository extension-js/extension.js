import {spawnSync} from 'node:child_process'
import * as fs from 'node:fs'
import {createRequire} from 'node:module'
import * as path from 'node:path'
import {beforeAll, describe, expect, it} from 'vitest'
import {trackTempFolders} from './helpers/temp-folders'

const require = createRequire(__filename)
const developRoot = path.resolve(__dirname, '..')
const distDir = path.join(developRoot, 'dist')
const tempFolder = trackTempFolders()

function packageDir(specifier: string) {
  return path.dirname(require.resolve(`${specifier}/package.json`))
}

// What a typed caller writes in a file of its own, checked against the
// declarations the package ships and not against the source.
const configExamples = `import type {FileConfig} from 'extension-develop'

export const startingUrl: FileConfig = {
  browser: {chrome: {startingUrl: 'https://example.com'}}
}

export const perBrowserBuildKeys: FileConfig = {
  browser: {
    firefox: {
      perfBudgets: {'service-worker': 10},
      define: {__API__: 'https://example.com'},
      transpilePackages: ['@acme/ui']
    }
  }
}

export const layeredBudgets: FileConfig = {
  perfBudgets: {'service-worker': 10000000},
  browser: {chrome: {perfBudgets: {'service-worker': 10}}}
}

export const refused: FileConfig = {
  // @ts-expect-error a key the loader never reads stays an error
  browser: {chrome: {startingUrll: 'https://example.com'}}
}
`

function readmeUsageExample(): string {
  const readme = fs.readFileSync(path.join(developRoot, 'README.md'), 'utf8')
  const usage = readme.slice(
    readme.indexOf('\n## Usage'),
    readme.indexOf('\n## Features')
  )
  const block = usage.match(/```ts\n([\s\S]*?)```/)

  expect(block, 'README.md has no ts block under "## Usage"').not.toBeNull()

  return String(block?.[1])
}

function typecheck(files: Record<string, string>) {
  const root = tempFolder('extjs-public-types-')

  for (const [name, source] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, name), source)
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
        typeRoots: [path.dirname(packageDir('@types/node'))],
        types: ['node'],
        paths: {
          'extension-develop': [path.join(distDir, 'module.d.ts')],
          'extension-develop/preview': [
            path.join(distDir, 'preview-entry.d.ts')
          ]
        }
      },
      files: Object.keys(files)
    })
  )

  const run = spawnSync(
    process.execPath,
    [
      path.join(packageDir('typescript'), 'bin', 'tsc'),
      '-p',
      root,
      '--pretty',
      'false'
    ],
    {cwd: root, encoding: 'utf8'}
  )

  return {
    status: run.status,
    errors: `${run.stdout}\n${run.stderr}`
      .split('\n')
      .filter((line) => line.includes('error TS'))
  }
}

describe('the declarations extension-develop ships', () => {
  beforeAll(() => {
    if (!fs.existsSync(path.join(distDir, 'module.d.ts'))) {
      throw new Error(
        `${distDir}/module.d.ts does not exist. Run ` +
          '`pnpm --filter extension-develop compile` before vitest.'
      )
    }
  })

  it('accept every browser key the config loader reads', () => {
    const result = typecheck({'extension.config.ts': configExamples})

    expect(result.errors).toEqual([])
    expect(result.status).toBe(0)
  }, 120_000)

  it('compile the Usage example of the README as written', () => {
    const example = readmeUsageExample()

    expect(example).toContain('extensionBuild(')
    expect(example).toContain('extensionPreview(')

    const result = typecheck({'usage.ts': example})

    expect(result.errors).toEqual([])
    expect(result.status).toBe(0)
  }, 120_000)

  it('refuse the calls the old README example made', () => {
    const result = typecheck({
      'old-usage.ts': `import {extensionDev, type DevOptions} from 'extension-develop'
// @ts-expect-error there is no extensionStart export
import {extensionStart} from 'extension-develop'

export const start: unknown = extensionStart
export const dev = () =>
  extensionDev(undefined, {
    browser: 'chrome',
    mode: 'development',
    // @ts-expect-error open is not an option
    open: true
  } satisfies DevOptions)
`
    })

    expect(result.errors).toEqual([])
    expect(result.status).toBe(0)
  }, 120_000)
})
