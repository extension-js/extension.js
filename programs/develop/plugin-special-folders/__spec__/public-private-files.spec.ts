import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {SpecialFoldersPlugin} from '..'
import {
  findPublicEnvFiles,
  privateFileIgnoreGlobs,
  privateFileKind
} from '../public-private-files'
import {
  compileFixture,
  type FixtureBuild,
  type FixtureFiles,
  type FixtureWatch,
  fixtureCompiler,
  makeFixtureRoot,
  removeFixtureRoots,
  watchFixture,
  writeFixtureFiles
} from './helpers/compile-harness'

afterEach(() => {
  removeFixtureRoots()
})

// Obvious fakes: no file here holds a real value.
const MARKER = 'FAKE-MARKER-NOT-A-REAL-VALUE'
const env = (name: string) => `EXAMPLE_KEY=${MARKER}-${name}\n`

const plugin = (folders?: {public?: string | false}) => ({
  apply(compiler: Parameters<SpecialFoldersPlugin['apply']>[0]) {
    new SpecialFoldersPlugin({
      manifestPath: path.join(
        String(compiler.options.context),
        'manifest.json'
      ),
      browser: 'firefox',
      folders
    }).apply(compiler)
  }
})

const BASE = {
  'index.js': 'self.out = 1\n',
  'manifest.json': '{"manifest_version": 3}'
}

async function build(
  files: FixtureFiles,
  folders?: {public?: string | false}
): Promise<FixtureBuild> {
  const result = await compileFixture({
    files: {...BASE, ...files},
    plugins: [plugin(folders)]
  })

  expect(result.outputPath).toBe(path.join(result.root, 'dist'))

  return result
}

const envWarnings = (result: FixtureBuild) =>
  result.warnings.filter((warning) => warning.name === 'PublicEnvFilesWarning')

// The marker sits in every env fixture, so it must reach neither the output
// folder nor a message.
function expectNoMarker(result: FixtureBuild) {
  expect(JSON.stringify(result.emitted)).not.toContain(MARKER)
  expect(JSON.stringify([result.warnings, result.errors])).not.toContain(MARKER)
}

describe('files in public/ that are not extension content', () => {
  it('leaves env files and OS metadata out of the output folder', async () => {
    const result = await build({
      'public/logo.txt': 'logo',
      'public/.env': env('root'),
      'public/cfg/.env.local': env('nested'),
      'public/.DS_Store': 'finder'
    })

    expect(Object.keys(result.emitted).sort()).toEqual(['logo.txt', 'main.js'])
    expect(Object.keys(result.assets).sort()).toEqual(['logo.txt', 'main.js'])
    expect(result.errors).toEqual([])
    expectNoMarker(result)
  })

  it('names the env files in one warning and says nothing of the others', async () => {
    const result = await build({
      'public/logo.txt': 'logo',
      'public/.env': env('root'),
      'public/cfg/.env.local': env('nested'),
      'public/.DS_Store': 'finder',
      'public/Thumbs.db': 'explorer',
      'public/.gitignore': 'node_modules\n'
    })

    expect(result.warnings).toHaveLength(1)
    expect(envWarnings(result)).toHaveLength(1)
    expect(envWarnings(result)[0].message).toBe(
      'public/.env, public/cfg/.env.local are env files, and they are left out of the firefox build.\n' +
        'Every file in the public folder ships inside the extension, where anyone who installs it can read it. ' +
        'Env files are read from the project root, so move them there, or delete them.'
    )

    expectNoMarker(result)
  })

  it('words the warning for a single env file', async () => {
    const result = await build({'public/.env.production': env('single')})

    expect(envWarnings(result).map((warning) => warning.message)).toEqual([
      'public/.env.production is an env file, and it is left out of the firefox build.\n' +
        'Every file in the public folder ships inside the extension, where anyone who installs it can read it. ' +
        'Env files are read from the project root, so move it there, or delete it.'
    ])
  })

  it('stays silent for a public folder with no env file', async () => {
    const result = await build({
      'public/logo.txt': 'logo',
      'public/.DS_Store': 'finder',
      'public/.env.example': 'EXAMPLE_KEY=\n'
    })

    expect(result.warnings).toEqual([])
    expect(Object.keys(result.emitted).sort()).toEqual([
      '.env.example',
      'logo.txt',
      'main.js'
    ])
  })

  it('ships dot-files that are web content and leaves repository and editor files out', async () => {
    const result = await build({
      'public/.well-known/assetlinks.json': '[]',
      'public/.nojekyll': '',
      'public/.htaccess': 'Options -Indexes\n',
      'public/.hidden/data.json': '{}',
      'public/x.env': 'not an env file by name',
      'public/environment.txt': 'plain content',
      'public/my.env.js': 'self.env = 1\n',
      'public/.git/config': '[core]\n',
      'public/.git/objects/aa/bb': 'blob',
      'public/vendor/.git': 'gitdir: ../../.git/modules/vendor\n',
      'public/.gitignore': 'node_modules\n',
      'public/.gitattributes': '* text=auto\n',
      'public/.gitmodules': '[submodule "vendor"]\n',
      'public/empty/.gitkeep': '',
      'public/.npmrc': `//registry.example/:_authToken=${MARKER}\n`,
      'public/.yarnrc.yml': `npmAuthToken: ${MARKER}\n`,
      'public/.notes.txt.swp': 'vim swap',
      'public/sub/.notes.txt.swo': 'vim swap',
      'public/notes.txt~': 'editor backup',
      'public/.envrc': `export EXAMPLE_KEY=${MARKER}\n`,
      'public/venv/.env/inner.txt': env('folder')
    })

    expect(Object.keys(result.emitted).sort()).toEqual([
      '.hidden/data.json',
      '.htaccess',
      '.nojekyll',
      '.well-known/assetlinks.json',
      'environment.txt',
      'main.js',
      'my.env.js',
      'x.env'
    ])

    // A folder that carries an env name is named with a slash, never walked.
    expect(envWarnings(result)).toHaveLength(1)
    expect(envWarnings(result)[0].message).toContain(
      'public/.envrc, public/venv/.env/ are env files'
    )

    expectNoMarker(result)
  })

  it('matches the names in any letter case', async () => {
    // One spelling per folder: a case-blind disk holds a single `.env`.
    const result = await build({
      'public/a/.ENV': env('upper'),
      'public/b/.Env.Local': env('mixed'),
      'public/c/.ds_store': 'finder',
      'public/d/THUMBS.DB': 'explorer',
      'public/e/Desktop.INI': 'explorer',
      'public/f/.GIT/config': '[core]\n',
      'public/g/.NPMRC': `token=${MARKER}\n`,
      'public/h/.ENV.EXAMPLE': 'EXAMPLE_KEY=\n',
      'public/i/.Notes.SWP': 'vim swap'
    })

    expect(Object.keys(result.emitted).sort()).toEqual([
      'h/.ENV.EXAMPLE',
      'main.js'
    ])

    expect(envWarnings(result)[0].message).toContain(
      'public/a/.ENV, public/b/.Env.Local are env files'
    )

    expectNoMarker(result)
  })

  it('keeps only the exact .env.example among the names that start like it', async () => {
    const result = await build({
      'public/.env.example': 'EXAMPLE_KEY=\n',
      'public/a/.env.e': env('e'),
      'public/a/.env.exa': env('exa'),
      'public/a/.env.exampl': env('exampl'),
      'public/a/.env.examples': env('examples'),
      'public/a/.env.example.local': env('example-local'),
      'public/a/.env.sample': env('sample'),
      'public/a/.env.': env('trailing-dot'),
      'public/a/.env.development.local': env('two-suffixes')
    })

    expect(Object.keys(result.emitted).sort()).toEqual([
      '.env.example',
      'main.js'
    ])

    expectNoMarker(result)
  })

  it('applies the same rules to a public folder whose path holds glob characters', async () => {
    const result = await build(
      {
        'we[i]rd (x) {y}/static/logo.txt': 'logo',
        'we[i]rd (x) {y}/static/.env': env('custom-folder'),
        'we[i]rd (x) {y}/static/.DS_Store': 'finder',
        'we[i]rd (x) {y}/static/nested/manifest.json': '{"nested": true}'
      },
      {public: 'we[i]rd (x) {y}/static'}
    )

    expect(Object.keys(result.emitted).sort()).toEqual([
      'logo.txt',
      'main.js',
      'nested/manifest.json'
    ])

    expect(envWarnings(result)[0].message).toContain(
      'static/.env is an env file'
    )

    expectNoMarker(result)
  })
})

describe('the private name rules', () => {
  it('sorts a name into its kind, or into none', () => {
    const kinds = (names: string[]) =>
      Object.fromEntries(names.map((name) => [name, privateFileKind(name)]))

    expect(
      kinds([
        '.DS_Store',
        'Thumbs.db',
        'desktop.ini',
        '.env',
        '.env.local',
        '.env.example',
        '.envrc',
        '.git',
        '.gitkeep',
        '.npmrc',
        '.a.swp',
        'a~',
        '.well-known',
        '.nojekyll',
        '_locales',
        'env',
        '.environment',
        'a.swp'
      ])
    ).toEqual({
      '.DS_Store': 'os',
      'Thumbs.db': 'os',
      'desktop.ini': 'os',
      '.env': 'env',
      '.env.local': 'env',
      '.env.example': undefined,
      '.envrc': 'env',
      '.git': 'tooling',
      '.gitkeep': 'tooling',
      '.npmrc': 'tooling',
      '.a.swp': 'tooling',
      'a~': 'tooling',
      '.well-known': undefined,
      '.nojekyll': undefined,
      _locales: undefined,
      env: undefined,
      '.environment': undefined,
      'a.swp': undefined
    })
  })

  it('writes the ignore list with forward slashes for either separator style', () => {
    for (const [dir, root] of [
      ['C:\\Users\\dev\\ext\\public', 'C:/Users/dev/ext/public'],
      ['/home/dev/ext/public', '/home/dev/ext/public']
    ]) {
      const globs = privateFileIgnoreGlobs(dir)

      expect(globs).toContain(`${root}/**/.[eE][nN][vV]`)
      expect(globs).toContain(`${root}/**/.[gG][iI][tT]/**`)
      expect(globs.filter((glob) => !glob.startsWith(`${root}/**/`))).toEqual(
        []
      )

      expect(globs.filter((glob) => glob.includes('\\'))).toEqual([])
    }
  })

  it('lists env files without walking a folder that is left out', () => {
    const root = makeFixtureRoot({
      'public/.env': env('root'),
      'public/deep/er/.env.test': env('deep'),
      'public/.git/.env': env('inside-git'),
      'public/venv/.env/nested/.env': env('inside-env-folder')
    })

    expect(findPublicEnvFiles(path.join(root, 'public'))).toEqual([
      '.env',
      'deep/er/.env.test',
      'venv/.env/'
    ])

    expect(findPublicEnvFiles(path.join(root, 'missing'))).toEqual([])
  })
})

const NEXT_BUILD_MS = 10_000

// Two writes can land in one build or in two, so wait for the build that
// shows the last of them.
async function buildWith(
  watch: FixtureWatch,
  from: number,
  shows: (result: FixtureBuild) => boolean
): Promise<FixtureBuild> {
  for (let count = from; ; count += 1) {
    const result = await watch.waitForBuild(count, NEXT_BUILD_MS)
    if (!result) throw new Error(`no build number ${count} arrived`)
    if (shows(result)) return result
  }
}

describe('a watch session over public/ with private files', () => {
  it('never ships one added mid-session and names an env file once per change of the list', async () => {
    const root = makeFixtureRoot({...BASE, 'public/logo.txt': 'logo'})
    const compiler = fixtureCompiler({
      root,
      mode: 'development',
      plugins: [plugin()]
    })
    const watch = watchFixture(root, compiler)
    const said = () =>
      watch.builds.flatMap((result) =>
        envWarnings(result).map((warning) => warning.message.split('\n')[0])
      )

    try {
      const first = await watch.waitForBuild(1, NEXT_BUILD_MS)
      expect(first?.outputPath).toBe(path.join(root, 'dist'))
      expect(Object.keys(first?.emitted || {}).sort()).toEqual([
        'logo.txt',
        'main.js'
      ])

      expect(said()).toEqual([])

      writeFixtureFiles(root, {
        'public/.env': env('added'),
        'public/.DS_Store': 'finder',
        'public/.git/config': '[core]\n',
        'public/one.txt': 'one'
      })

      const added = await buildWith(
        watch,
        2,
        (result) => result.emitted['one.txt'] === 'one'
      )
      expect(Object.keys(added.emitted).sort()).toEqual([
        'logo.txt',
        'main.js',
        'one.txt'
      ])

      expect(said()).toEqual([
        'public/.env is an env file, and it is left out of the firefox build.'
      ])

      // Rebuilds that leave the list alone say nothing more.
      for (const round of ['two', 'three', 'four']) {
        fs.writeFileSync(path.join(root, 'public', '.env'), env(round))
        fs.writeFileSync(path.join(root, 'public', 'one.txt'), round)
        const again = await buildWith(
          watch,
          watch.builds.length + 1,
          (result) => result.emitted['one.txt'] === round
        )
        expect(again.emitted['.env']).toBeUndefined()
      }

      expect(said()).toHaveLength(1)

      writeFixtureFiles(root, {
        'public/cfg/.env.local': env('second'),
        'public/one.txt': 'five'
      })

      await buildWith(
        watch,
        watch.builds.length + 1,
        (result) => result.emitted['one.txt'] === 'five'
      )

      expect(said()).toEqual([
        'public/.env is an env file, and it is left out of the firefox build.',
        'public/.env, public/cfg/.env.local are env files, and they are left out of the firefox build.'
      ])

      const last = watch.builds[watch.builds.length - 1]
      expect(Object.keys(last.emitted).sort()).toEqual([
        'logo.txt',
        'main.js',
        'one.txt'
      ])

      for (const result of watch.builds) expectNoMarker(result)
    } finally {
      await watch.close()
    }
  })

  it('stays silent in a new compiler on the same folder, the way a restarted session is', async () => {
    const root = makeFixtureRoot({...BASE, 'public/.env': env('restart')})

    const session = async () => {
      const compiler = fixtureCompiler({
        root,
        mode: 'development',
        plugins: [plugin()]
      })
      const watch = watchFixture(root, compiler)

      try {
        const first = await watch.waitForBuild(1, NEXT_BUILD_MS)
        if (!first) throw new Error('no first build arrived')

        return first
      } finally {
        await watch.close()
      }
    }

    const before = await session()
    const after = await session()

    expect(envWarnings(before)).toHaveLength(1)
    expect(envWarnings(after)).toHaveLength(0)
    expect(after.emitted['.env']).toBeUndefined()
  })
})
