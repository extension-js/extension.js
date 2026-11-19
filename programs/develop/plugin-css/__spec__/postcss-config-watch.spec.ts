import * as fs from 'node:fs'
import * as path from 'node:path'
import {type Compiler, rspack} from '@rspack/core'
import {afterEach, describe, expect, it} from 'vitest'
import {resolveDevelopDistFile} from '../../lib/develop-context'
import {postCssConfigHelpers} from '../css-tools/postcss'
import {CssPlugin} from '../index'
import {cssProjects} from './helpers/css-project'

const makeProject = cssProjects()
const WARN = '⏵⏵⏵ Warning:'

interface Build {
  css: string
  setupWarnings: string[]
  errors: string[]
}

interface DevSession {
  firstBuild: Promise<Build | undefined>
  buildAfter: (
    act: () => void,
    matches?: (build: Build) => boolean
  ) => Promise<Build | undefined>
  // The build one save of the sheet alone starts: the watcher names the files
  // behind each build, so a late event for an earlier write is told apart.
  buildOfSheetAlone: (contents: string) => Promise<Build | undefined>
  close: () => Promise<void>
}

const sessions: DevSession[] = []

afterEach(async () => {
  while (sessions.length > 0) await sessions.pop()?.close()
})

// A real development watch with the rules CssPlugin builds, which name the
// compiled loaders.
async function dev(root: string): Promise<DevSession> {
  const loader = resolveDevelopDistFile('late-css-import-loader')

  if (!fs.existsSync(loader)) {
    throw new Error(
      `This spec compiles with the loaders in programs/develop/dist and ${loader} is missing. ` +
        'Run `pnpm --filter extension-develop compile` first.'
    )
  }

  // A file written a moment ago reads as an edit to a watcher that starts
  // now, and that rebuild would pass for the one a test waits on.
  const past = new Date(Date.now() - 60000)

  for (const entry of fs.readdirSync(root, {recursive: true}) as string[]) {
    fs.utimesSync(path.join(root, entry), past, past)
  }

  const compiler: Compiler = rspack({
    context: root,
    mode: 'development',
    devtool: false,
    entry: {main: './entry.js'},
    output: {path: path.join(root, 'out')}
  })

  await new CssPlugin({manifestPath: path.join(root, 'manifest.json')}).apply(
    compiler
  )

  const builds: Build[] = []
  const startedBy = new WeakMap<Build, string[]>()
  const waiters = new Set<() => void>()
  let changed: string[] = []

  compiler.hooks.watchRun.tap('spec', () => {
    changed = [
      ...(compiler.modifiedFiles || []),
      ...(compiler.removedFiles || [])
    ].map((file) => path.relative(root, file))
  })

  compiler.hooks.done.tap('spec', (stats) => {
    const sheet = path.join(root, 'out', 'main.css')
    const build: Build = {
      css: fs.existsSync(sheet)
        ? fs.readFileSync(sheet, 'utf8').replace(/\s+/g, '')
        : '',
      setupWarnings: stats.compilation.warnings
        .filter((w) => w.name === 'CssSetupWarning')
        .map((w) => w.message.replace(/^\s*(?:⚠|│)\s?/gm, '').trimEnd()),
      errors: stats.compilation.errors.map((e) => e.message)
    }

    startedBy.set(build, changed)
    builds.push(build)

    for (const wake of [...waiters]) wake()
  })

  // The compiler's own done hook answers the wait. The clock only bounds it,
  // so a rebuild that never comes reads as undefined.
  const buildAfter: DevSession['buildAfter'] = (act, matches = () => true) => {
    const from = builds.length

    return new Promise((resolve) => {
      const wake = () => {
        const found = builds.slice(from).find(matches)
        if (!found) return

        clearTimeout(timer)
        waiters.delete(wake)
        resolve(found)
      }

      const timer = setTimeout(() => {
        waiters.delete(wake)
        resolve(undefined)
      }, 20000)

      waiters.add(wake)
      act()
    })
  }

  const buildOfSheetAlone: DevSession['buildOfSheetAlone'] = async (
    contents
  ) => {
    // A build that also answers an older write says nothing about this one,
    // so the sheet is saved again until a build has it for its only cause.
    for (let attempt = 0; attempt < 10; attempt++) {
      const build = await buildAfter(
        () => fs.writeFileSync(path.join(root, 'styles.css'), contents),
        (candidate) => startedBy.get(candidate)?.includes('styles.css') === true
      )

      // A watcher may name the folder of the sheet beside the sheet.
      const others = (startedBy.get(build as Build) ?? []).filter(
        (file) => file !== 'styles.css' && file !== ''
      )

      if (!build || others.length === 0) return build
    }

    return undefined
  }

  let watching: ReturnType<Compiler['watch']> | undefined
  const session: DevSession = {
    firstBuild: buildAfter(() => {
      watching = compiler.watch({aggregateTimeout: 20}, () => {})
    }),
    buildAfter,
    buildOfSheetAlone,
    close: () =>
      new Promise<void>((resolve) => {
        watching?.close(() => compiler.close(() => resolve()))
      })
  }

  sessions.push(session)

  return session
}

// A config whose one plugin stamps each rule with the word it was given.
function stampingConfig(file: string, word: string) {
  const body = [
    '{',
    '  plugins: [',
    '    {',
    "      postcssPlugin: 'stamp',",
    '      Rule(rule) {',
    `        rule.append({prop: '--stamp', value: '${word}'})`,
    '      }',
    '    }',
    '  ]',
    '}',
    ''
  ].join('\n')

  // A config that is data names its plugin by a path from the project.
  return file.endsWith('.json')
    ? JSON.stringify({plugins: {[`./stamp-${word}.cjs`]: {}}})
    : file.endsWith('.yaml')
      ? `plugins:\n  ./stamp-${word}.cjs: {}\n`
      : file.endsWith('.mjs')
        ? `export default ${body}`
        : `module.exports = ${body}`
}

// A plugin in a file of its own, written the way a published one is.
function stampPlugin(word: string) {
  return [
    `module.exports = () => ({postcssPlugin: 'stamp', Rule(rule) { rule.append({prop: '--stamp', value: '${word}'}) }})`,
    'module.exports.postcss = true',
    ''
  ].join('\n')
}

const SHEET = {
  'entry.js': 'import "./styles.css"\n',
  'styles.css': '.a{color:red}\n',
  'stamp-first.cjs': stampPlugin('first'),
  'stamp-second.cjs': stampPlugin('second')
}

const saveSheet = (root: string) => () =>
  fs.writeFileSync(path.join(root, 'styles.css'), '.a{color:red}\n')

describe('a PostCSS config edited while a dev session runs', () => {
  it.each([
    'postcss.config.js',
    'postcss.config.cjs',
    'postcss.config.mjs',
    '.postcssrc.json',
    '.postcssrc.yaml'
  ])('%s: the next build compiles the sheets with the new config', async (file) => {
    const root = makeProject({
      ...SHEET,
      [file]: ''
    })
    fs.writeFileSync(
      path.join(root, file),
      stampingConfig(path.join(root, file), 'first')
    )

    const session = await dev(root)
    const first = {
      css: '.a{color:red;--stamp:first}',
      setupWarnings: [],
      errors: []
    }

    expect(await session.firstBuild).toEqual(first)
    // A save the watcher answers shows it is live before the config changes.
    expect(await session.buildAfter(saveSheet(root))).toEqual(first)

    const rebuilt = await session.buildAfter(() =>
      fs.writeFileSync(
        path.join(root, file),
        stampingConfig(path.join(root, file), 'second')
      )
    )

    expect(rebuilt).toEqual({
      css: '.a{color:red;--stamp:second}',
      setupWarnings: [],
      errors: []
    })
  })

  // The helper two requires down is no config file, and changes the answer.
  it('an edit to a file a helper of the config requires rebuilds with the new value', async () => {
    const file = 'postcss.config.cjs'
    const deep = (word: string) => `module.exports = '${word}'\n`
    const root = makeProject({
      ...SHEET,
      [file]: [
        "const word = require('./tokens/index.cjs')",
        'module.exports = {',
        "  plugins: [{postcssPlugin: 'stamp', Rule(rule) { rule.append({prop: '--stamp', value: word}) }}]",
        '}',
        ''
      ].join('\n'),
      'tokens/index.cjs': "module.exports = require('./deep.cjs')\n",
      'tokens/deep.cjs': deep('first')
    })
    const session = await dev(root)
    const first = {
      css: '.a{color:red;--stamp:first}',
      setupWarnings: [],
      errors: []
    }

    expect(await session.firstBuild).toEqual(first)
    expect(await session.buildAfter(saveSheet(root))).toEqual(first)

    const rebuilt = await session.buildAfter(() =>
      fs.writeFileSync(path.join(root, 'tokens', 'deep.cjs'), deep('second'))
    )

    expect(rebuilt).toEqual({
      css: '.a{color:red;--stamp:second}',
      setupWarnings: [],
      errors: []
    })

    expect(postCssConfigHelpers(root).sort()).toEqual([
      path.join(root, 'tokens', 'deep.cjs'),
      path.join(root, 'tokens', 'index.cjs')
    ])

    // A config that is gone has no helper left to watch.
    fs.rmSync(path.join(root, file))

    expect(postCssConfigHelpers(root)).toEqual([])
  })

  it('a config written into a project that had no PostCSS asks for a restart, once', async () => {
    const root = makeProject(SHEET)
    const config = path.join(root, 'postcss.config.cjs')
    const session = await dev(root)
    const plain = {css: '.a{color:red}', setupWarnings: [], errors: []}

    expect(await session.firstBuild).toEqual(plain)
    expect(await session.buildAfter(saveSheet(root))).toEqual(plain)

    const rebuilt = await session.buildAfter(() =>
      fs.writeFileSync(config, stampingConfig(config, 'first'))
    )

    expect(rebuilt).toEqual({
      css: '.a{color:red}',
      setupWarnings: [
        [
          `${WARN} The PostCSS setup changed in a way this session can't apply while it runs.`,
          `PATH ${config}`,
          'Stop it and run extension dev again to apply the change.'
        ].join('\n')
      ],
      errors: []
    })

    // The next save of a sheet is not a config change, so nothing repeats.
    const next = await session.buildOfSheetAlone('.a{color:blue}\n')

    expect(next).toEqual({css: '.a{color:blue}', setupWarnings: [], errors: []})
  })

  // A problem with the config belongs to the build that read the config,
  // where every reporter and the JSON output read it, and is said once.
  it('a config PostCSS cannot use is reported on the build that read it, once', async () => {
    const root = makeProject({
      ...SHEET,
      '.postcssrc.json': JSON.stringify({
        plugins: {'postcss-plugin-nowhere': {}}
      }),
      'package.json': JSON.stringify({
        name: 'css-fixture',
        packageManager: 'pnpm@10.0.0'
      })
    })
    const config = path.join(root, '.postcssrc.json')
    const session = await dev(root)

    expect(await session.firstBuild).toEqual({
      css: '.a{color:red}',
      setupWarnings: [
        [
          `${WARN} Couldn't resolve the PostCSS plugin postcss-plugin-nowhere.`,
          'The plugin was skipped so the build can continue.',
          'Styles it would generate are missing from the output.',
          `PATH ${root}`,
          'Install it in your project to re-enable it: pnpm add -D postcss-plugin-nowhere'
        ].join('\n')
      ],
      errors: []
    })

    expect(await session.buildAfter(saveSheet(root))).toEqual({
      css: '.a{color:red}',
      setupWarnings: [],
      errors: []
    })

    const fixed = await session.buildAfter(() =>
      fs.writeFileSync(config, stampingConfig(config, 'first'))
    )

    expect(fixed).toEqual({
      css: '.a{color:red;--stamp:first}',
      setupWarnings: [],
      errors: []
    })
  })
})

describe('a dev session that opens a second compiler on the same project', () => {
  it('warns about the config once, in the first of them', async () => {
    const root = makeProject({
      ...SHEET,
      '.postcssrc.json': JSON.stringify({
        plugins: {'postcss-plugin-nowhere': {}}
      })
    })
    const first = await dev(root)

    expect((await first.firstBuild)?.setupWarnings).toHaveLength(1)

    await sessions.pop()?.close()

    const second = await dev(root)

    expect((await second.firstBuild)?.setupWarnings).toEqual([])
  })
})

describe('a PostCSS config whose plugins are not a list or a map', () => {
  it('is reported on the build, and the sheets compile without it', async () => {
    const root = makeProject({
      ...SHEET,
      '.postcssrc.json': JSON.stringify({plugins: 5})
    })
    const session = await dev(root)

    expect(await session.firstBuild).toEqual({
      css: '.a{color:red}',
      setupWarnings: [
        [
          `${WARN} The PostCSS config at ${path.join(root, '.postcssrc.json')} lists plugins as number.`,
          'PostCSS expects an array or an object keyed by plugin name.',
          'The build continues without this config, so none of its plugins run.'
        ].join('\n')
      ],
      errors: []
    })
  })
})

describe('a config under a name PostCSS never reads', () => {
  it.each([
    ['postcss.config.json', '.postcssrc.json'],
    ['postcss.config.yaml', '.postcssrc.yaml'],
    ['postcss.config.yml', '.postcssrc.yml']
  ])('%s is named once with the name to give it', async (file, rename) => {
    const root = makeProject({...SHEET, [file]: '{}\n'})
    const session = await dev(root)

    expect(await session.firstBuild).toEqual({
      css: '.a{color:red}',
      setupWarnings: [
        [
          `${WARN} PostCSS reads no config by this name, so the file was ignored.`,
          `PATH ${path.join(root, file)}`,
          `Rename it to ${rename} to apply it.`
        ].join('\n')
      ],
      errors: []
    })

    const next = await session.buildOfSheetAlone('.a{color:blue}\n')

    expect(next?.setupWarnings).toEqual([])
  })
})
