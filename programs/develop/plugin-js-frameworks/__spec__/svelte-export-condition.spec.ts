import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {rspack, type Stats} from '@rspack/core'
import {afterAll, describe, expect, it} from 'vitest'
import {getProjectStructure} from '../../lib/project'
import webpackConfig from '../../rspack-config'

const WORKSPACE_MODULES = path.resolve(__dirname, '../../../../node_modules')
const roots: string[] = []

// A mirror instead of one symlink to the shared tree, so each fixture can add
// its own packages under its own node_modules.
function mirrorWorkspaceModules(root: string) {
  const modules = path.join(root, 'node_modules')
  fs.mkdirSync(modules, {recursive: true})

  for (const entry of fs.readdirSync(WORKSPACE_MODULES)) {
    if (entry === 'svelte' || entry.startsWith('.')) continue

    const target = path.join(WORKSPACE_MODULES, entry)
    const type = fs.statSync(target).isDirectory() ? 'junction' : 'file'

    fs.symlinkSync(target, path.join(modules, entry), type)
  }
}

function scaffold(
  name: string,
  options: {svelte: boolean},
  files: Record<string, string | object>
) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), `extjs-svelte-cond-${name}-`))
  )
  roots.push(root)

  const write = (relative: string, contents: string | object) => {
    const target = path.join(root, relative)
    fs.mkdirSync(path.dirname(target), {recursive: true})
    fs.writeFileSync(
      target,
      typeof contents === 'string' ? contents : JSON.stringify(contents)
    )
  }

  write('package.json', {
    private: true,
    name: `extjs-svelte-cond-${name}`,
    version: '0.0.0',
    dependencies: options.svelte ? {svelte: '*'} : {}
  })

  write('manifest.json', {
    manifest_version: 3,
    name: `svelte-cond-${name}`,
    version: '0.0.0',
    action: {default_popup: 'popup.html'}
  })

  write(
    'popup.html',
    '<!doctype html><html><body><script type="module" src="./popup.js"></script></body></html>'
  )

  mirrorWorkspaceModules(root)

  // Only a project that uses Svelte gets the workspace svelte in its tree,
  // so the other one is detected as a plain project.
  if (options.svelte) {
    fs.symlinkSync(
      path.join(WORKSPACE_MODULES, 'svelte'),
      path.join(root, 'node_modules', 'svelte'),
      'junction'
    )
  }

  for (const [relative, contents] of Object.entries(files)) {
    write(relative, contents)
  }

  return root
}

async function compile(
  root: string,
  mode: 'development' | 'production' = 'production'
) {
  const projectStructure = await getProjectStructure(root)
  const config = webpackConfig(projectStructure, {
    browser: 'chrome',
    mode,
    metadataCommand: mode === 'production' ? 'build' : 'dev',
    silent: true,
    output: {clean: false, path: path.join(root, 'dist', 'chrome')}
  })
  config.plugins = (config.plugins || []).filter(
    (plugin) =>
      plugin?.constructor.name !== 'plugin-browsers' &&
      plugin?.constructor.name !== 'plugin-ready-contract'
  )

  config.stats = false
  config.optimization = {...config.optimization, minimize: false}

  const stats = await new Promise<Stats>((resolve, reject) => {
    rspack(config).run((error, result) => {
      if (error) return reject(error)
      if (!result) return reject(new Error('no stats'))

      resolve(result)
    })
  })

  const distPath = path.join(root, 'dist', 'chrome')
  const entries = fs.existsSync(distPath)
    ? (fs.readdirSync(distPath, {recursive: true}) as unknown[])
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

// The way Svelte component libraries publish: the `svelte` condition only.
const svelteOnlyLibrary = {
  'node_modules/svelte-only-lib/package.json': {
    name: 'svelte-only-lib',
    version: '1.0.0',
    type: 'module',
    exports: {
      '.': {svelte: './index.js'},
      './active': {svelte: './active.js'}
    }
  },
  'node_modules/svelte-only-lib/index.js':
    "export default function router() { return 'svelteOnlyRootMarker' }\n",
  'node_modules/svelte-only-lib/active.js':
    "export default function active() { return 'svelteOnlyActiveMarker' }\n"
}

describe('packages published under the svelte export condition', () => {
  afterAll(() => {
    for (const root of roots) {
      fs.rmSync(root, {recursive: true, force: true})
    }
  })

  it('resolves a package exported only under svelte in a Svelte project', async () => {
    const root = scaffold(
      'root',
      {svelte: true},
      {
        ...svelteOnlyLibrary,
        'popup.js':
          "import router from 'svelte-only-lib'\n" +
          'document.title = router()\n'
      }
    )

    const {errors, emitted} = await compile(root)

    expect(errors).toEqual([])
    expect(emitted).toContain('svelteOnlyRootMarker')
  }, 180_000)

  it('resolves it the same way in development', async () => {
    const root = scaffold(
      'dev',
      {svelte: true},
      {
        ...svelteOnlyLibrary,
        'popup.js':
          "import router from 'svelte-only-lib'\n" +
          'document.title = router()\n'
      }
    )

    const {errors, emitted} = await compile(root, 'development')

    expect(errors).toEqual([])
    expect(emitted).toContain('svelteOnlyRootMarker')
  }, 180_000)

  it('resolves a subpath exported only under svelte', async () => {
    const root = scaffold(
      'subpath',
      {svelte: true},
      {
        ...svelteOnlyLibrary,
        'popup.js':
          "import active from 'svelte-only-lib/active'\n" +
          'document.title = active()\n'
      }
    )

    const {errors, emitted} = await compile(root)

    expect(errors).toEqual([])
    expect(emitted).toContain('svelteOnlyActiveMarker')
    expect(emitted).not.toContain('svelteOnlyRootMarker')
  }, 180_000)

  it('compiles a component library whose entry re-exports a .svelte file', async () => {
    const root = scaffold(
      'component',
      {svelte: true},
      {
        'node_modules/svelte-button-lib/package.json': {
          name: 'svelte-button-lib',
          version: '1.0.0',
          type: 'module',
          exports: {'.': {svelte: './index.js'}}
        },
        'node_modules/svelte-button-lib/index.js':
          "export {default as Button} from './Button.svelte'\n",
        'node_modules/svelte-button-lib/Button.svelte':
          "<script>export let label = 'ok'</script>\n" +
          '<button class="svelteButtonLibMarker">{label}</button>\n',
        'popup.js':
          "import {mount} from 'svelte'\n" +
          "import {Button} from 'svelte-button-lib'\n" +
          "mount(Button, {target: document.body, props: {label: 'ok'}})\n"
      }
    )

    const {errors, emitted} = await compile(root)

    expect(errors).toEqual([])
    expect(emitted).toContain('svelteButtonLibMarker')
  }, 180_000)

  it('picks the svelte entry over default in a Svelte project', async () => {
    const root = scaffold(
      'both',
      {svelte: true},
      {
        'node_modules/dual-lib/package.json': {
          name: 'dual-lib',
          version: '1.0.0',
          type: 'module',
          exports: {'.': {svelte: './svelte.js', default: './plain.js'}}
        },
        'node_modules/dual-lib/svelte.js':
          "export default 'dualLibSvelteMarker'\n",
        'node_modules/dual-lib/plain.js':
          "export default 'dualLibPlainMarker'\n",
        'popup.js': "import value from 'dual-lib'\ndocument.title = value\n"
      }
    )

    const {errors, emitted} = await compile(root)

    expect(errors).toEqual([])
    expect(emitted).toContain('dualLibSvelteMarker')
    expect(emitted).not.toContain('dualLibPlainMarker')
  }, 180_000)

  it('keeps the plain exports error in a project without Svelte', async () => {
    const root = scaffold(
      'plain',
      {svelte: false},
      {
        ...svelteOnlyLibrary,
        'popup.js':
          "import router from 'svelte-only-lib'\n" +
          'document.title = router()\n'
      }
    )

    const {errors} = await compile(root)

    expect(errors.join('\n')).toMatch(
      /Package subpath '\.' is not defined by "exports"/
    )
  }, 180_000)

  it('picks default over svelte in a project without Svelte', async () => {
    const root = scaffold(
      'plain-dual',
      {svelte: false},
      {
        'node_modules/dual-lib/package.json': {
          name: 'dual-lib',
          version: '1.0.0',
          type: 'module',
          exports: {'.': {svelte: './svelte.js', default: './plain.js'}}
        },
        'node_modules/dual-lib/svelte.js':
          "export default 'dualLibSvelteMarker'\n",
        'node_modules/dual-lib/plain.js':
          "export default 'dualLibPlainMarker'\n",
        'popup.js': "import value from 'dual-lib'\ndocument.title = value\n"
      }
    )

    const {errors, emitted} = await compile(root)

    expect(errors).toEqual([])
    expect(emitted).toContain('dualLibPlainMarker')
    expect(emitted).not.toContain('dualLibSvelteMarker')
  }, 180_000)
})
