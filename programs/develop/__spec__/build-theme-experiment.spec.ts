import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// Firefox theme_experiment: the built manifest names a stylesheet under
// theme_experiment/ and that file must exist there, compiled, whatever
// dialect it was authored in.
const roots: string[] = []

// The sass package is the project's own optional dependency; when the repo
// cannot resolve one, the compile leg is skipped rather than faked.
function resolveSass(): string | undefined {
  try {
    return path.dirname(require.resolve('sass/package.json'))
  } catch {
    return undefined
  }
}
const sassDir = resolveSass()

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(stylesheetName: string, source: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-theme-exp-'))
  roots.push(root)
  const usesSass = /\.s[ac]ss$/.test(stylesheetName)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      private: true,
      name: 'theme-exp',
      version: '0.0.0',
      ...(usesSass && sassDir ? {devDependencies: {sass: '*'}} : {})
    })
  )
  if (usesSass && sassDir) {
    fs.mkdirSync(path.join(root, 'node_modules'), {recursive: true})
    fs.symlinkSync(sassDir, path.join(root, 'node_modules', 'sass'), 'dir')
  }
  fs.mkdirSync(path.join(root, 'theme'))
  fs.writeFileSync(path.join(root, 'theme', stylesheetName), source)
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 2,
      name: 'Theme Experiment',
      version: '1.0.0',
      theme: {colors: {frame: [1, 2, 3]}},
      theme_experiment: {
        stylesheet: `theme/${stylesheetName}`,
        colors: {popup: '--arrowpanel-background'}
      }
    })
  )
  return root
}

async function build(root: string) {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'
  try {
    const summary = await extensionBuild(root, {
      browser: 'firefox',
      silent: true,
      install: false,
      mode: 'production',
      exitOnError: false
    } as any)
    expect(summary.errors_count).toBe(0)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
  const distDir = path.join(root, 'dist', 'firefox')
  const manifest = JSON.parse(
    fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8')
  )
  return {distDir, manifest}
}

describe('theme_experiment stylesheet', () => {
  it('is emitted where the built manifest points', async () => {
    const {distDir, manifest} = await build(
      project('chrome.css', '.tab { color: red; }\n')
    )
    expect(manifest.theme_experiment.stylesheet).toBe(
      'theme_experiment/chrome.css'
    )
    const emitted = fs.readFileSync(
      path.join(distDir, manifest.theme_experiment.stylesheet),
      'utf8'
    )
    expect(emitted).toContain('color')
  }, 120_000)

  it.skipIf(!sassDir)(
    'compiles a scss source into the advertised css name',
    async () => {
      const {distDir, manifest} = await build(
        project('chrome.scss', '$c: red;\n.tab { color: $c; }\n')
      )
      expect(manifest.theme_experiment.stylesheet).toBe(
        'theme_experiment/chrome.css'
      )
      const emitted = fs.readFileSync(
        path.join(distDir, manifest.theme_experiment.stylesheet),
        'utf8'
      )
      expect(emitted).not.toContain('$c')
      expect(emitted).toMatch(/color:\s*red/)
    },
    120_000
  )
})
