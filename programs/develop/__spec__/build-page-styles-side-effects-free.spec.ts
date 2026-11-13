import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {workspacePackage} from './helpers/workspace-package'

const SVELTE_PACKAGES = {
  svelte: workspacePackage('svelte'),
  'svelte-loader': workspacePackage('svelte-loader')
}
const hasSvelte = Object.values(SVELTE_PACKAGES).every(Boolean)
const VUE_PACKAGE = workspacePackage('vue')
const VUE_SCOPE = workspacePackage('@vue/runtime-dom')
const hasVue = VUE_PACKAGE !== undefined && VUE_SCOPE !== undefined

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function write(root: string, rel: string, content: string) {
  const file = path.join(root, rel)
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, content)
}

function link(root: string, name: string, target: string) {
  const at = path.join(root, 'node_modules', name)
  fs.mkdirSync(path.dirname(at), {recursive: true})
  fs.symlinkSync(target, at, 'dir')
}

// A page imports each of these for its effect alone. sideEffects: false in
// the project's package.json says such an import can go, and the sheet went.
function project(options: {
  sideEffectsFree: boolean
  popup: string
  files: Record<string, string>
  framework?: 'svelte' | 'vue'
}) {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), 'extjs-page-styles-')
  )
  roots.push(root)
  const dependencies: Record<string, string> = {}

  if (options.framework === 'svelte') {
    for (const [name, dir] of Object.entries(SVELTE_PACKAGES)) {
      link(root, name, dir as string)
    }

    dependencies.svelte = '*'
  }

  if (options.framework === 'vue') {
    link(root, 'vue', VUE_PACKAGE as string)
    link(root, '@vue', path.dirname(VUE_SCOPE as string))
    dependencies.vue = '*'
  }

  write(
    root,
    'package.json',
    JSON.stringify({
      private: true,
      name: 'page-styles',
      version: '0.0.0',
      ...(options.sideEffectsFree ? {sideEffects: false} : {}),
      dependencies
    })
  )

  write(
    root,
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: 'Page styles',
      version: '1.0.0',
      action: {default_popup: 'popup.html'}
    })
  )

  write(
    root,
    'popup.html',
    '<!doctype html><title>POPUP</title><div id="root"></div><script type="module" src="./popup.js"></script>'
  )

  write(root, 'popup.js', options.popup)

  for (const [rel, content] of Object.entries(options.files)) {
    write(root, rel, content)
  }

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

  return fs
    .readdirSync(distDir, {recursive: true})
    .map(String)
    .filter((entry) => entry.endsWith('.css'))
    .sort()
    .map((entry) => fs.readFileSync(path.join(distDir, entry), 'utf8'))
    .join('\n')
}

const PLAIN = {
  popup:
    "import './src/plain.css'\nimport './src/unread.module.css'\n" +
    "document.getElementById('root').className = 'probe_plain'\n",
  files: {
    'src/plain.css': '.probe_plain { color: rgb(51, 52, 53); }\n',
    'src/unread.module.css': '.probe_unread { color: rgb(81, 82, 83); }\n'
  }
}

const SVELTE = {
  popup:
    "import {mount} from 'svelte'\nimport Page from './src/Page.svelte'\n" +
    "mount(Page, {target: document.getElementById('root')})\n",
  files: {
    'src/Page.svelte':
      '<p class="probe_svelte">styled</p>\n' +
      '<style>\n  .probe_svelte { color: rgb(11, 12, 13); }\n</style>\n'
  }
}

const VUE = {
  popup:
    "import {createApp} from 'vue'\nimport Page from './src/Page.vue'\n" +
    "createApp(Page).mount('#root')\n",
  files: {
    'src/Page.vue':
      '<template>\n  <p class="probe_vue">styled</p>\n' +
      '  <p class="probe_scoped">scoped</p>\n</template>\n\n' +
      '<style>\n.probe_vue { color: rgb(21, 22, 23); }\n</style>\n\n' +
      '<style scoped>\n.probe_scoped { color: rgb(31, 32, 33); }\n</style>\n'
  }
}

describe('a page stylesheet in a project with sideEffects: false', () => {
  it('keeps a stylesheet the page imports for its effect', async () => {
    const css = await build(project({sideEffectsFree: true, ...PLAIN}))

    expect(css).toMatch(/\.probe_plain\{color:#333435\}/)
    // A CSS module's class is renamed, so the color is what names the rule.
    expect(css).toMatch(/\{color:#515253\}/)
  }, 180_000)

  it('builds the bytes a project without the flag builds', async () => {
    const flagged = await build(project({sideEffectsFree: true, ...PLAIN}))
    const plain = await build(project({sideEffectsFree: false, ...PLAIN}))

    expect(flagged).toBe(plain)
  }, 180_000)

  it.skipIf(!hasSvelte)(
    "keeps a Svelte component's block",
    async () => {
      const css = await build(
        project({sideEffectsFree: true, framework: 'svelte', ...SVELTE})
      )

      expect(css).toMatch(/\.probe_svelte\.svelte-[\w-]+\{color:#0b0c0d\}/)
    },
    180_000
  )

  it.skipIf(!hasVue)(
    "keeps a Vue component's blocks",
    async () => {
      const css = await build(
        project({sideEffectsFree: true, framework: 'vue', ...VUE})
      )

      expect(css).toMatch(/\.probe_vue\{color:#151617\}/)
      expect(css).toMatch(/\.probe_scoped\[data-v-[\w-]+\]\{color:#1f2021\}/)
    },
    180_000
  )
})
