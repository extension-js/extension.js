import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {createRequire as nodeCreateRequire} from 'module'
import postcss from 'postcss'

describe('postcss integration (tailwind arbitrary classes)', () => {
  let tmpRoot = ''

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-postcss-int-'))
    process.env.EXTENSION_AUTHOR_MODE = 'false'
  })

  afterEach(() => {
    if (tmpRoot && fs.existsSync(tmpRoot)) {
      fs.rmSync(tmpRoot, {recursive: true, force: true})
    }
  })

  it('emits arbitrary gradient-stop utility from fixture sources', async () => {
    vi.resetModules()
    vi.doMock('../../css-lib/integrations', () => ({
      hasDependency: (_p: string, dep: string) =>
        dep === 'tailwindcss' || dep === '@tailwindcss/postcss',
      installOptionalDependencies: vi.fn(async () => true),
      resolveDevelopInstallRoot: vi.fn(() => undefined)
    }))
    vi.doMock('../../css-tools/tailwind', () => ({
      isUsingTailwind: () => true
    }))
    vi.doMock('module', async () => {
      const actual = await vi.importActual<any>('module')
      const realReq = nodeCreateRequire(import.meta.url)
      return {
        ...actual,
        createRequire: () => (id: string) => realReq(id)
      }
    })

    const srcSidebar = path.join(tmpRoot, 'src', 'sidebar')
    fs.mkdirSync(srcSidebar, {recursive: true})

    // Signal Tailwind usage to maybeUsePostCss via dependency detection.
    fs.writeFileSync(
      path.join(tmpRoot, 'package.json'),
      JSON.stringify(
        {
          name: 'fixture-tailwind-arbitrary',
          private: true,
          devDependencies: {
            tailwindcss: '^4.0.0',
            '@tailwindcss/postcss': '^4.0.0'
          }
        },
        null,
        2
      )
    )
    const fixtureNodeModules = path.join(tmpRoot, 'node_modules')
    fs.mkdirSync(fixtureNodeModules, {recursive: true})
    const workspaceTailwindPath = path.join(
      process.cwd(),
      '..',
      '..',
      'node_modules',
      'tailwindcss'
    )
    expect(fs.existsSync(workspaceTailwindPath)).toBe(true)
    const tailwindDest = path.join(fixtureNodeModules, 'tailwindcss')
    // On Windows use real path + copy to avoid EPERM (symlinks/junctions in pnpm store)
    if (process.platform === 'win32') {
      const realSource = fs.realpathSync(workspaceTailwindPath)
      fs.cpSync(realSource, tailwindDest, {recursive: true})
    } else {
      try {
        fs.symlinkSync(workspaceTailwindPath, tailwindDest, 'dir')
      } catch (err: any) {
        if (err?.code === 'EPERM' || err?.code === 'ENOTSUP') {
          fs.cpSync(fs.realpathSync(workspaceTailwindPath), tailwindDest, {
            recursive: true
          })
        } else {
          throw err
        }
      }
    }

    // Tailwind v4 entry plus explicit source hint.
    const cssFile = path.join(srcSidebar, 'sidebar-index.css')
    fs.writeFileSync(
      cssFile,
      [
        "@import 'tailwindcss';",
        '@source "../**/*.{ts,tsx,js,jsx,html}";',
        ''
      ].join('\n')
    )

    // Fixture content containing arbitrary classes that previously regressed.
    fs.writeFileSync(
      path.join(srcSidebar, 'app.tsx'),
      [
        'export function App() {',
        '  return <div className="bg-gradient-to-b from-[#1a1333] via-[#2d4065] to-[#7aafa4]" />',
        '}',
        ''
      ].join('\n')
    )

    const {maybeUsePostCss} = await import('../../css-tools/postcss')
    const rule = await maybeUsePostCss(tmpRoot, {mode: 'development'})
    const plugins = (rule.options?.postcssOptions?.plugins || []) as any[]
    const executablePlugins = plugins.filter(
      (plugin) =>
        typeof plugin === 'function' ||
        (plugin && typeof plugin === 'object' && 'postcssPlugin' in plugin)
    )
    const tailwindPlugin = executablePlugins[0]
    expect(tailwindPlugin).toBeDefined()

    const out = await postcss([tailwindPlugin] as any).process(
      fs.readFileSync(cssFile, 'utf8'),
      {from: cssFile}
    )

    expect(out.css).toContain('.from-\\[\\#1a1333\\]')
    expect(out.css).toContain('--tw-gradient-stops')
    expect(out.css).toContain('.via-\\[\\#2d4065\\]')
    expect(out.css).toContain('.to-\\[\\#7aafa4\\]')
  })
})
