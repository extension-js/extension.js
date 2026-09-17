import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// A Vue project must ship the runtime-only build: the full build carries the
// template compiler, which extension CSP cannot run and the Firefox store
// rejects. The fixture copies the real vue package and stamps each bundler
// entry with a marker, so the emitted bundle names the entry it was built from.
const WORKSPACE_MODULES = path.resolve(__dirname, '../../../node_modules')
const VUE_PACKAGE = path.join(WORKSPACE_MODULES, 'vue')
const hasVue = fs.existsSync(path.join(VUE_PACKAGE, 'package.json'))

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function write(root: string, rel: string, content: string) {
  const file = path.join(root, rel)
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, content)
}

function stamp(file: string, entry: string) {
  fs.appendFileSync(
    file,
    `\nglobalThis.__extjsVueEntry = ${JSON.stringify(entry)}\n`
  )
}

function installVue(root: string) {
  const target = path.join(root, 'node_modules', 'vue')
  fs.cpSync(VUE_PACKAGE, target, {recursive: true, dereference: true})
  stamp(path.join(target, 'dist', 'vue.runtime.esm-bundler.js'), 'runtime')
  stamp(path.join(target, 'dist', 'vue.esm-bundler.js'), 'full')
  stamp(path.join(target, 'dist', 'vue.cjs.js'), 'cjs')
  stamp(path.join(target, 'dist', 'vue.cjs.prod.js'), 'cjs')

  // The @vue/* packages the copy imports resolve through this workspace.
  fs.symlinkSync(
    path.join(WORKSPACE_MODULES, '@vue'),
    path.join(root, 'node_modules', '@vue'),
    'dir'
  )

  return JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8'))
    .version as string
}

function project() {
  // vue-loader's include is the project path as spelled, so the fixture
  // lives at the real path like the sources the bundler hands the loader.
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), 'extjs-vue-runtime-')
  )
  roots.push(root)
  const version = installVue(root)

  write(
    root,
    'package.json',
    JSON.stringify({
      private: true,
      name: 'vue-runtime',
      version: '0.0.0',
      dependencies: {vue: version}
    })
  )

  write(
    root,
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: 'Vue runtime',
      version: '1.0.0',
      action: {default_popup: 'popup.html'}
    })
  )

  write(
    root,
    'popup.html',
    '<!doctype html><title>POPUP</title><div id="root"></div><script type="module" src="./popup.js"></script>'
  )

  write(
    root,
    'popup.js',
    "import {createApp} from 'vue'\nimport App from './App.vue'\ncreateApp(App).mount('#root')\n"
  )

  // Options API on purpose: data() and methods are the code path the
  // __VUE_OPTIONS_API__ flag tree-shakes away when it is off.
  write(
    root,
    'App.vue',
    '<template><p @click="bump">{{ label }} {{ count }}</p></template>\n' +
      '<script>\nexport default {\n  data() {\n    return {count: 0, label: "clicks"}\n  },\n' +
      '  methods: {\n    bump() {\n      this.count += 1\n    }\n  }\n}\n</script>\n'
  )

  return root
}

async function build(root: string) {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'
  const lines: string[] = []
  const originalLog = console.log
  const originalError = console.error
  console.log = (...args: unknown[]) => lines.push(args.join(' '))
  console.error = (...args: unknown[]) => lines.push(args.join(' '))
  let summary: {errors_count: number}

  try {
    summary = await extensionBuild(root, {
      browser: 'chrome',
      silent: false,
      install: false,
      mode: 'production',
      exitOnError: false
    } as any)
  } catch (error) {
    throw new Error(`build failed: ${String(error)}\n${lines.join('\n')}`)
  } finally {
    console.log = originalLog
    console.error = originalError
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }

  if (summary.errors_count > 0) {
    throw new Error(`build failed:\n${lines.join('\n')}`)
  }

  const distDir = path.join(root, 'dist', 'chrome')
  const emitted = fs
    .readdirSync(distDir, {recursive: true} as any)
    .map((entry) => String(entry))
    .filter((entry) => entry.endsWith('.js'))
    .map((entry) => fs.readFileSync(path.join(distDir, entry), 'utf8'))
    .join('\n')

  return {emitted, output: lines.join('\n')}
}

describe.skipIf(!hasVue)('Vue production build', () => {
  it('bundles the runtime-only entry, keeps the Options API and no global shim', async () => {
    const built = await build(project())

    // The marker only the runtime entry carries is in, the markers of the
    // full ESM entry and the CommonJS main are out.
    expect(built.emitted).toMatch(/__extjsVueEntry\s*=\s*["']runtime["']/)
    expect(built.emitted).not.toMatch(/__extjsVueEntry\s*=\s*["']full["']/)
    expect(built.emitted).not.toMatch(/__extjsVueEntry\s*=\s*["']cjs["']/)

    // The component's data() and methods reach the bundle, and so does the
    // runtime code that applies them: a false flag strips beforeCreate and mixins.
    expect(built.emitted).toContain('clicks')
    expect(built.emitted).toMatch(/\.beforeCreate\b/)
    expect(built.emitted).toMatch(/\bmixins\b/)

    // global resolves to globalThis at build time, never through a Function shim.
    expect(built.emitted).not.toMatch(/Function\(\s*["']return this["']\s*\)/)
  }, 180_000)
})
