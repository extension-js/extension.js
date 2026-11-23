import * as fs from 'node:fs'
import * as path from 'node:path'
import {type Compiler, rspack} from '@rspack/core'
import {afterEach, describe, expect, it} from 'vitest'
import {CssPlugin} from '../index'
import {cssProjects} from './helpers/css-project'

const makeProject = cssProjects()

interface Build {
  warnings: string[]
  errors: string[]
}

interface WatchSession {
  firstBuild: Promise<Build | undefined>
  buildAfter: (
    act: () => void,
    matches?: (build: Build) => boolean,
    waitMs?: number
  ) => Promise<Build | undefined>
  close: () => Promise<void>
}

const sessions: WatchSession[] = []

afterEach(async () => {
  for (const session of sessions.splice(0).reverse()) await session.close()
})

// A real watch with CssPlugin applied. A plain css rule stands in for the
// rules production defers to beforeRun, which a watch never calls.
function watch(root: string): WatchSession {
  // A file written a moment ago reads as an edit to a watcher that starts
  // now, and that rebuild would pass for the one a test waits on.
  const past = new Date(Date.now() - 60000)

  for (const entry of fs.readdirSync(root, {recursive: true}) as string[]) {
    fs.utimesSync(path.join(root, entry), past, past)
  }

  const compiler: Compiler = rspack({
    context: root,
    mode: 'production',
    devtool: false,
    entry: {main: './entry.js'},
    output: {path: path.join(root, 'out')},
    module: {rules: [{test: /\.css$/, type: 'css'}]},
    optimization: {minimize: false}
  })

  void new CssPlugin({manifestPath: path.join(root, 'manifest.json')}).apply(
    compiler
  )

  const builds: Build[] = []
  const waiters = new Set<() => void>()

  compiler.hooks.done.tap('spec', (stats) => {
    builds.push({
      warnings: stats.compilation.warnings.map((w) => w.name),
      errors: stats.compilation.errors.map((e) => e.message)
    })

    for (const wake of [...waiters]) wake()
  })

  // The compiler's own done hook answers the wait. The clock only bounds it,
  // so a rebuild that never comes reads as undefined.
  const buildAfter: WatchSession['buildAfter'] = (
    act,
    matches = () => true,
    waitMs = 20000
  ) => {
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
      }, waitMs)

      waiters.add(wake)
      act()
    })
  }

  let watching: ReturnType<Compiler['watch']> | undefined
  const session: WatchSession = {
    firstBuild: buildAfter(() => {
      watching = compiler.watch({aggregateTimeout: 20}, () => {})
    }),
    buildAfter,
    close: () =>
      new Promise<void>((resolve) => {
        watching?.close(() => compiler.close(() => resolve()))
      })
  }

  sessions.push(session)

  return session
}

const FOUND = {warnings: [], errors: []}
const DEAD = {warnings: ['CssDeadRef'], errors: []}

const isClean = (build: Build) =>
  build.warnings.length === 0 && build.errors.length === 0
const reportsDeadRef = (build: Build) => build.warnings.includes('CssDeadRef')

function project(request: string, files: Record<string, string> = {}) {
  const css = `.a{background:url(${request})}\n`
  const root = makeProject({
    'entry.js': 'import "./styles/cs.css"',
    'styles/cs.css': css,
    ...files
  })
  const sheet = path.join(root, 'styles', 'cs.css')

  return {root, saveSheet: () => fs.writeFileSync(sheet, css)}
}

describe('a dead url() in a watch session', () => {
  it.each([
    ['beside the sheet', './missing.png', 'styles/missing.png'],
    [
      'in a folder that does not exist yet',
      '../img/deep/missing.png',
      'img/deep/missing.png'
    ],
    [
      'named with a query and a hash',
      './missing.png?v=2#icon',
      'styles/missing.png'
    ]
  ])('rebuilds without the finding once the file %s is written', async (_label, request, target) => {
    const {root, saveSheet} = project(request)
    const file = path.join(root, target)
    const session = watch(root)

    expect(await session.firstBuild).toEqual(DEAD)
    // A save the watcher answers shows it is live before the file lands.
    expect(await session.buildAfter(saveSheet)).toEqual(DEAD)

    const rebuilt = await session.buildAfter(() => {
      fs.mkdirSync(path.dirname(file), {recursive: true})
      fs.writeFileSync(file, 'image')
    }, isClean)

    expect(rebuilt).toEqual(FOUND)
  })

  it('reports the finding once a referenced file is deleted', async () => {
    const {root, saveSheet} = project('./real.png', {
      'styles/real.png': 'image'
    })
    const session = watch(root)

    expect(await session.firstBuild).toEqual(FOUND)
    expect(await session.buildAfter(saveSheet)).toEqual(FOUND)

    const rebuilt = await session.buildAfter(
      () => fs.rmSync(path.join(root, 'styles', 'real.png')),
      reportsDeadRef
    )

    expect(rebuilt).toEqual(DEAD)
  })
})
