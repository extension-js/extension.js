import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {
  buildWith,
  compileFixture,
  type FixtureBuild,
  type FixtureFiles,
  fixtureCompiler,
  makeFixtureRoot,
  removeFixtureRoots,
  watchFixture,
  writeFixtureFiles
} from '../../__spec__/helpers/compile-harness'
import {
  browserSpellings,
  climbsOut,
  findPublicEnvFiles,
  isEnvTemplateFileName,
  privateFileIgnoreGlobs,
  privateFileKind,
  rootAbsolutePathIsWithheld,
  sourceFileMayShip
} from '../../lib/public-private-files'
import {SpecialFoldersPlugin} from '..'

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

  it('keeps the template env files and leaves out every other name that starts like one', async () => {
    const kept = [
      '.env.example',
      'a/.env.sample',
      'a/.env.template',
      'a/.env.local.example',
      'a/.env.production.sample',
      'a/.env.staging.template',
      'a/.env..example',
      'b/.ENV.SAMPLE',
      'b/.Env.Local.Template',
      // A folder with a template name ships with what it holds.
      'c/.env.example/notes.txt'
    ]
    const leftOut = [
      'a/.env.',
      'a/.env.e',
      'a/.env.le',
      'a/.env.exa',
      'a/.env.exampl',
      'a/.env.ample',
      'a/.env.xample',
      'a/.env.examples',
      'a/.env.example.local',
      'a/.env.sample.local',
      'a/.env.samples',
      'a/.env.xsample',
      'a/.env.template.local',
      'a/.env.emplate',
      'a/.env.templates',
      'a/.env.localexample',
      'a/.env.local.exampl',
      'a/.env.development.local',
      'a/.env.te',
      'a/.env.late'
    ]
    const result = await build({
      ...Object.fromEntries(kept.map((file) => [`public/${file}`, 'KEY=\n'])),
      ...Object.fromEntries(
        leftOut.map((file) => [`public/${file}`, env(file)])
      )
    })

    expect(Object.keys(result.emitted).sort()).toEqual(
      [...kept, 'main.js'].sort()
    )

    // The warning lists what the copier left out, name for name.
    expect(envWarnings(result)).toHaveLength(1)
    expect(findPublicEnvFiles(path.join(result.root, 'public'))).toEqual(
      [...leftOut].sort()
    )

    expectNoMarker(result)
  })

  it('agrees with the copier on every name, one predicate for both', () => {
    for (const name of [
      '.env.example',
      '.env.sample',
      '.env.template',
      '.env.local.example',
      '.env.production.sample',
      '.ENV.TEMPLATE'
    ]) {
      expect(isEnvTemplateFileName(name), name).toBe(true)
      expect(privateFileKind(name), name).toBeUndefined()
    }

    for (const name of [
      '.env',
      '.envrc',
      '.env.',
      '.env.local',
      '.env.example.local',
      '.env.examples',
      '.env.localexample',
      '.envexample',
      '.envrc.example',
      'env.example',
      'config.example'
    ]) {
      expect(isEnvTemplateFileName(name), name).toBe(false)
    }

    expect(privateFileKind('.env.localexample')).toBe('env')
    expect(privateFileKind('.env.example.local')).toBe('env')
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
        '.env.sample',
        '.env.template',
        '.env.local.example',
        '.env.example.local',
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
      '.env.sample': undefined,
      '.env.template': undefined,
      '.env.local.example': undefined,
      '.env.example.local': 'env',
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

describe('whether a source file may ship', () => {
  // The project sits one folder down, so there is an outside to reach.
  function holderProject() {
    const holder = fs.realpathSync(makeFixtureRoot())
    const root = path.join(holder, 'project')

    writeFixtureFiles(holder, {
      'outside.txt': `${MARKER}-outside`,
      'outside-folder/inner.txt': `${MARKER}-outside-folder`,
      'project/.env': env('root'),
      'project/.git/config': `# ${MARKER}-git`,
      'project/node_modules/pkg/data.json': '{}',
      'project/node_modules/pkg/.env': env('package'),
      'project/node_modules/.npmrc': `# ${MARKER}-npmrc`,
      'project/vendor/node_modules/pkg/lib.js': 'var a = 1\n',
      'project/data/ok.json': '{}',
      'project/data/.DS_Store': '',
      'project/.well-known/links.json': '[]',
      'project/.env.example': 'EXAMPLE_KEY=\n',
      'project/src/manifest.json': '{}',
      'project/src/logo.png': 'png'
    })

    return {holder, root}
  }

  it('says yes to project content, by either root it is given', () => {
    const {root} = holderProject()
    const src = path.join(root, 'src')

    for (const file of [
      'data/ok.json',
      'data',
      '.well-known/links.json',
      '.env.example',
      'src/logo.png',
      'data/../data/ok.json',
      // A file the author names ships from an installed package.
      'node_modules/pkg/data.json',
      'vendor/node_modules/pkg/lib.js'
    ]) {
      expect(sourceFileMayShip(path.join(root, file), [root]), file).toBe(true)
    }

    expect(sourceFileMayShip(path.join(src, 'logo.png'), [src])).toBe(true)
    // The manifest folder alone does not own a file beside it.
    expect(sourceFileMayShip(path.join(root, 'data/ok.json'), [src])).toBe(
      false
    )

    expect(
      sourceFileMayShip(path.join(root, 'data/ok.json'), [src, root])
    ).toBe(true)
  })

  it('says no to a private name, a climb and a missing file', () => {
    const {holder, root} = holderProject()

    for (const file of [
      '.env',
      '.ENV',
      '.git/config',
      '.git',
      'data/.DS_Store',
      'node_modules/pkg/.env',
      'node_modules/.npmrc',
      'data/../.env',
      '../outside.txt',
      'data/../../outside.txt',
      'nothing.txt',
      '.'
    ]) {
      expect(sourceFileMayShip(path.join(root, file), [root]), file).toBe(false)
    }

    expect(sourceFileMayShip(path.join(holder, 'outside.txt'), [root])).toBe(
      false
    )

    expect(sourceFileMayShip(path.join(root, 'data/ok.json'), [])).toBe(false)
  })

  it.skipIf(process.platform === 'win32')(
    'follows a link to the place it leads',
    () => {
      const {holder, root} = holderProject()
      const link = (target: string, name: string) =>
        fs.symlinkSync(target, path.join(root, name))

      link(path.join(root, 'data', 'ok.json'), 'alias.json')
      link(path.join(root, 'data'), 'alias-folder')
      link(path.join(holder, 'outside.txt'), 'linked.txt')
      link(path.join(holder, 'outside-folder'), 'linked-folder')
      link(path.join(root, '.env'), 'settings.txt')
      link(path.join(root, 'node_modules', 'pkg'), 'vendored')
      link(path.join(root, 'data', 'ok.json'), '.npmrc')
      link(path.join(root, 'nowhere.txt'), 'broken.txt')

      const answers = Object.fromEntries(
        [
          'alias.json',
          'alias-folder/ok.json',
          'linked.txt',
          'linked-folder',
          'linked-folder/inner.txt',
          'settings.txt',
          'vendored/data.json',
          '.npmrc',
          'broken.txt'
        ].map((file) => [
          file,
          sourceFileMayShip(path.join(root, file), [root])
        ])
      )

      expect(answers).toEqual({
        'alias.json': true,
        'alias-folder/ok.json': true,
        'linked.txt': false,
        'linked-folder': false,
        'linked-folder/inner.txt': false,
        'settings.txt': false,
        'vendored/data.json': true,
        '.npmrc': false,
        'broken.txt': false
      })
    }
  )

  it('answers a walk and a named file apart inside installed packages', () => {
    const {root} = holderProject()
    const asked = (file: string) => [
      sourceFileMayShip(path.join(root, file), [root]),
      sourceFileMayShip(path.join(root, file), [root], 'named'),
      sourceFileMayShip(path.join(root, file), [root], 'walked')
    ]

    // With no kind given the ask is for a file the author named.
    expect(asked('node_modules/pkg/data.json')).toEqual([true, true, false])
    expect(asked('node_modules/pkg')).toEqual([true, true, false])
    expect(asked('node_modules')).toEqual([true, true, false])
    expect(asked('vendor/node_modules/pkg/lib.js')).toEqual([true, true, false])
    expect(asked('data/ok.json')).toEqual([true, true, true])
    // A private name is one inside a package as well.
    expect(asked('node_modules/pkg/.env')).toEqual([false, false, false])
    expect(asked('node_modules/.npmrc')).toEqual([false, false, false])
  })

  it.skipIf(process.platform === 'win32')(
    'follows a package link into a store of the project or of a folder above it',
    () => {
      const {holder, root} = holderProject()
      const store = (base: string, name: string) =>
        `${base}node_modules/.pnpm/${name}@1.0.0/node_modules/${name}`

      writeFixtureFiles(holder, {
        [`${store('project/', 'inside')}/data.json`]: '{}',
        [`${store('project/', 'inside')}/.env`]: env('store'),
        [`${store('', 'above')}/data.json`]: '{}',
        'node_modules/.npmrc': `# ${MARKER}-above-npmrc`,
        'elsewhere/stray/data.json': `${MARKER}-stray`,
        'other-project/node_modules/far/data.json': `${MARKER}-far`,
        'node_modules-backup/kept/data.json': `${MARKER}-backup`
      })

      const link = (target: string, name: string) =>
        fs.symlinkSync(
          path.join(holder, target),
          path.join(root, 'node_modules', name)
        )

      link(store('project/', 'inside'), 'inside')
      link(store('', 'above'), 'above')
      link('elsewhere/stray', 'stray')
      link('other-project/node_modules/far', 'far')
      link('node_modules-backup/kept', 'kept')
      link('node_modules/.npmrc', 'settings.txt')
      link('node_modules', 'whole-store')
      // A link outside `node_modules` that leads into the store above.
      fs.symlinkSync(
        path.join(holder, store('', 'above'), 'data.json'),
        path.join(root, 'above.json')
      )

      const files = [
        'node_modules/inside/data.json',
        'node_modules/inside/.env',
        'node_modules/above/data.json',
        'node_modules/stray/data.json',
        'node_modules/far/data.json',
        'node_modules/kept/data.json',
        'node_modules/settings.txt',
        'node_modules/whole-store',
        'above.json'
      ]
      const answers = (ask: 'named' | 'walked') =>
        Object.fromEntries(
          files.map((file) => [
            file,
            sourceFileMayShip(path.join(root, file), [root], ask)
          ])
        )

      expect(answers('named')).toEqual({
        'node_modules/inside/data.json': true,
        'node_modules/inside/.env': false,
        'node_modules/above/data.json': true,
        'node_modules/stray/data.json': false,
        'node_modules/far/data.json': false,
        'node_modules/kept/data.json': false,
        'node_modules/settings.txt': false,
        'node_modules/whole-store': false,
        'above.json': true
      })

      expect(answers('walked')).toEqual(
        Object.fromEntries(files.map((file) => [file, false]))
      )

      // The manifest folder is a root too, and the store sits above both.
      expect(
        sourceFileMayShip(path.join(root, 'node_modules/above/data.json'), [
          path.join(root, 'src')
        ])
      ).toBe(false)

      expect(
        sourceFileMayShip(path.join(root, 'node_modules/above/data.json'), [
          root,
          path.join(root, 'src')
        ])
      ).toBe(true)
    }
  )
})

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

describe('whether a root-absolute path is refused as written', () => {
  it('refuses a path that climbs out of the extension root, in any spelling', () => {
    for (const ref of [
      '/../outside.txt',
      '/a/../../outside.txt',
      '/%2e%2e/outside.txt',
      '/%2E%2E/outside.txt',
      '/a/%2E%2E/%2e%2e/outside.txt',
      '/..',
      '/..\\outside.txt',
      '../outside.txt',
      '//../outside.txt'
    ]) {
      expect(rootAbsolutePathIsWithheld(ref), ref).toBe(true)
    }
  })

  it('refuses a private name anywhere along the path, in any spelling', () => {
    for (const ref of [
      '/.env',
      '/.ENV',
      '/.env.local',
      '/cfg/.env.production',
      '/.git/config',
      '/a/../.env',
      '/%2eenv',
      '/%2Egit/config',
      '/node_modules/pkg/.npmrc',
      '.env'
    ]) {
      expect(rootAbsolutePathIsWithheld(ref), ref).toBe(true)
    }
  })

  it('lets every other path go on to the file lookup', () => {
    for (const ref of [
      '/data/ok.json',
      '/a/../data/ok.json',
      '/.env.example',
      '/.well-known/links.json',
      '/node_modules/pkg/worker.js',
      '/a%20b.txt',
      // Not a valid escape, so the browser asks for the name as written.
      '/100%.txt',
      '/',
      ''
    ]) {
      expect(rootAbsolutePathIsWithheld(ref), ref).toBe(false)
    }
  })

  it('reads a leading slash as the extension root, never as the disk root', () => {
    const holder = fs.realpathSync(makeFixtureRoot())
    const root = path.join(holder, 'project')
    const outside = path.join(holder, 'outside.txt')

    writeFixtureFiles(holder, {
      'outside.txt': `${MARKER}-outside`,
      'project/data/ok.json': '{}',
      'project/.env': env('root')
    })

    const inside = path.join(root, 'data', 'ok.json')

    // A real file outside the project and a real one inside get the answer
    // any path under the extension root gets, and no file is looked at.
    expect(fs.existsSync(outside)).toBe(true)
    expect(rootAbsolutePathIsWithheld(outside)).toBe(false)
    expect(rootAbsolutePathIsWithheld(inside)).toBe(false)
    expect(rootAbsolutePathIsWithheld('/abs/path/outside.txt')).toBe(false)
    expect(rootAbsolutePathIsWithheld('/etc/hosts')).toBe(false)
    // The private name still decides, wherever the path seems to lead.
    expect(rootAbsolutePathIsWithheld(path.join(root, '.env'))).toBe(true)
    expect(rootAbsolutePathIsWithheld('/abs/path/.npmrc')).toBe(true)
  })

  it('spells a name the way it was written and the way the browser reads it', () => {
    expect(browserSpellings('a/%2e%2e/b.txt')).toEqual([
      'a/%2e%2e/b.txt',
      'b.txt'
    ])

    expect(browserSpellings('%2e%2e/x')).toEqual(['%2e%2e/x', '../x'])
    expect(browserSpellings('a\\..\\..\\x')).toEqual(['../x', '../x'])
    expect(browserSpellings('100%.txt')).toEqual(['100%.txt'])
    expect(climbsOut('..')).toBe(true)
    expect(climbsOut('../x')).toBe(true)
    expect(climbsOut('..x/y')).toBe(false)
    expect(climbsOut('a/../x')).toBe(false)
  })
})
