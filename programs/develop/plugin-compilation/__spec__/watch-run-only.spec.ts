import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {EnvPlugin} from '../env'
import {WatchProjectConfigPlugin} from '../watch-project-config'
import {
  createCompiler,
  makeTempRoot,
  removeTempRoots,
  runCompiler,
  writeFiles
} from './helpers/real-compile'

afterAll(() => {
  removeTempRoots()
})

// rspack gives every compiler a watchOptions object, so these rows run the
// real one: a one-shot build must pass the watch-only work by.
describe('a one-shot build on a real compiler', () => {
  it('leaves the env files out of the build dependencies', async () => {
    const root = makeTempRoot('build-env-deps')
    writeFiles(root, {
      'entry.js': 'console.log(process.env.EXTENSION_PUBLIC_A)\n',
      '.env.chrome': 'EXTENSION_PUBLIC_A=1\n'
    })

    const compiler = createCompiler({
      context: root,
      outputPath: path.join(root, 'out'),
      entry: {entry: './entry.js'},
      plugins: [new EnvPlugin({browser: 'chrome'})]
    })
    const stats = await runCompiler(compiler)

    expect(compiler.options.watchOptions).toBeTruthy()
    expect([...stats.compilation.fileDependencies]).not.toContain(
      path.join(root, '.env.chrome')
    )

    expect([...stats.compilation.missingDependencies]).not.toContain(
      path.join(root, '.env.production')
    )
  })

  it('never reports a config edit as one a running session missed', async () => {
    const root = makeTempRoot('build-config-edit')
    writeFiles(root, {
      'entry.js': 'console.log(1)\n',
      'extension.config.js': 'export default {}\n'
    })

    // An earlier compiler in this process read the config first.
    new WatchProjectConfigPlugin(root)
    fs.writeFileSync(
      path.join(root, 'extension.config.js'),
      'export default {define: {A: "1"}}\n'
    )

    const stats = await runCompiler(
      createCompiler({
        context: root,
        outputPath: path.join(root, 'out'),
        entry: {entry: './entry.js'},
        plugins: [new WatchProjectConfigPlugin(root)]
      })
    )

    expect(Array.from(stats.compilation.warnings, (w) => w.name)).toEqual([])
  })
})
