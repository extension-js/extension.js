import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {rspack, type Stats} from '@rspack/core'
import {afterAll, describe, expect, it} from 'vitest'
import {getProjectStructure} from '../../lib/project'
import webpackConfig from '../../rspack-config'

const WORKSPACE_MODULES = path.resolve(__dirname, '../../../../node_modules')
const roots: string[] = []

// A mirror instead of one symlink to the shared tree: these fixtures own files
// under their OWN node_modules, which a single link to the workspace cannot.
function mirrorWorkspaceModules(root: string) {
  const modules = path.join(root, 'node_modules')
  fs.mkdirSync(modules, {recursive: true})

  for (const entry of fs.readdirSync(WORKSPACE_MODULES)) {
    const target = path.join(WORKSPACE_MODULES, entry)
    const type = fs.statSync(target).isDirectory() ? 'junction' : 'file'

    fs.symlinkSync(target, path.join(modules, entry), type)
  }

  return modules
}

function scaffold(
  name: string,
  dependencies: Record<string, string>,
  files: Record<string, string>
) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), `extjs-sources-${name}-`))
  )
  roots.push(root)

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify(
      {
        private: true,
        name: `extjs-sources-${name}`,
        version: '0.0.0',
        dependencies
      },
      null,
      2
    )
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify(
      {
        manifest_version: 3,
        name: `sources-${name}`,
        version: '0.0.0',
        action: {default_popup: 'popup.html'}
      },
      null,
      2
    )
  )

  mirrorWorkspaceModules(root)

  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(root, relative)
    fs.mkdirSync(path.dirname(target), {recursive: true})
    fs.writeFileSync(target, contents)
  }

  return root
}

async function compileDev(root: string) {
  const projectStructure = await getProjectStructure(root)
  const config = webpackConfig(projectStructure, {
    browser: 'chrome',
    mode: 'development',
    metadataCommand: 'dev',
    silent: true,
    output: {clean: false, path: path.join(root, 'dist', 'chrome')}
  } as any)
  config.plugins = (config.plugins || []).filter(
    (plugin) =>
      plugin?.constructor.name !== 'plugin-browsers' &&
      plugin?.constructor.name !== 'plugin-playwright'
  )

  config.stats = false

  const stats = await new Promise<Stats>((resolve, reject) => {
    rspack(config).run((error, result) => {
      if (error) return reject(error)
      if (!result) return reject(new Error('no stats'))

      resolve(result)
    })
  })

  const distPath = path.join(root, 'dist', 'chrome')
  const entries = fs.existsSync(distPath)
    ? (fs.readdirSync(distPath, {recursive: true} as any) as unknown[])
    : []
  const emitted = entries
    .map((entry) => String(entry))
    .filter((entry) => entry.endsWith('.js'))
    .map((entry) => fs.readFileSync(path.join(distPath, entry), 'utf-8'))
    .join('\n')

  return {
    errors: (stats.toJson({errors: true}).errors || []).map(
      (error) => error.message || String(error)
    ),
    emitted
  }
}

describe('source shapes an installed dependency and TS NodeNext produce', () => {
  afterAll(() => {
    for (const root of roots) {
      fs.rmSync(root, {recursive: true, force: true})
    }
  })

  it('compiles a .svelte component that ships inside node_modules', async () => {
    const root = scaffold(
      'svelte-dep',
      {svelte: '*'},
      {
        'popup.html':
          '<!doctype html><html><body><script type="module" src="./popup.js"></script></body></html>',
        'popup.js':
          "import {mount} from 'svelte'\n" +
          "import Button from 'fancy-svelte-lib/Button.svelte'\n" +
          "mount(Button, {target: document.body, props: {label: 'ok'}})\n",
        'node_modules/fancy-svelte-lib/package.json': JSON.stringify({
          name: 'fancy-svelte-lib',
          version: '1.0.0',
          main: 'index.js'
        }),
        'node_modules/fancy-svelte-lib/index.js': 'export default {}\n',
        'node_modules/fancy-svelte-lib/Button.svelte':
          "<script>export let label = 'ok'</script>\n" +
          '<button class="fancySvelteLibButton">{label}</button>\n'
      }
    )

    const {errors, emitted} = await compileDev(root)

    expect(errors).toEqual([])
    expect(emitted).toContain('fancySvelteLibButton')
  }, 180_000)

  it('compiles a .cts module through swc, by every spelling that resolves it', async () => {
    const root = scaffold(
      'cts',
      {},
      {
        'tsconfig.json': JSON.stringify({
          compilerOptions: {module: 'esnext', moduleResolution: 'bundler'}
        }),
        'popup.html':
          '<!doctype html><html><body><script type="module" src="./popup.ts"></script></body></html>',
        'popup.ts':
          "import {greet} from './helper.cjs'\n" +
          "import {farewell} from './farewell.cts'\n" +
          "import {plain} from './plain'\n" +
          'document.title = [greet(), farewell(), plain()].join(" ")\n',
        'helper.cts':
          "export function greet(): string {\n  return 'ctsHelloFromNodeNext'\n}\n",
        'farewell.cts':
          "export function farewell(): string {\n  return 'ctsByeExplicit'\n}\n",
        'plain.cts':
          "export function plain(): string {\n  return 'ctsPlainExtensionless'\n}\n"
      }
    )

    const {errors, emitted} = await compileDev(root)

    expect(errors).toEqual([])
    expect(emitted).toContain('ctsHelloFromNodeNext')
    expect(emitted).toContain('ctsByeExplicit')
    expect(emitted).toContain('ctsPlainExtensionless')
  }, 180_000)
})
