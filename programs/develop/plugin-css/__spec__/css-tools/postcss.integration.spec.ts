import * as fs from 'node:fs'
import {createRequire as nodeCreateRequire} from 'node:module'
import * as os from 'node:os'
import * as path from 'node:path'
import postcss, {type AcceptedPlugin} from 'postcss'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {maybeUsePostCss} from '../../css-tools/postcss'

// The workspace's own copy of a package, linked into a fixture project.
function linkWorkspacePackage(root: string, name: string) {
  // The entry file names the package folder even when the package exports
  // no package.json.
  const entry = nodeCreateRequire(import.meta.url).resolve(name)
  const marker = `${path.sep}node_modules${path.sep}${name.split('/').join(path.sep)}`
  const source = entry.slice(0, entry.lastIndexOf(marker) + marker.length)
  const dest = path.join(root, 'node_modules', name)

  fs.mkdirSync(path.dirname(dest), {recursive: true})

  try {
    if (process.platform === 'win32') throw new Error('copy')

    fs.symlinkSync(source, dest, 'dir')
  } catch {
    // Windows needs a privilege to link, so the package is copied there.
    fs.cpSync(fs.realpathSync(source), dest, {recursive: true})
  }
}

describe('postcss integration (tailwind arbitrary classes)', () => {
  let tmpRoot = ''

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-postcss-int-'))
    vi.stubEnv('EXTENSION_AUTHOR_MODE', 'false')
  })

  afterEach(() => {
    vi.unstubAllEnvs()

    if (tmpRoot && fs.existsSync(tmpRoot)) {
      fs.rmSync(tmpRoot, {recursive: true, force: true})
    }
  })

  it('emits arbitrary gradient-stop utility from fixture sources', async () => {
    const srcSidebar = path.join(tmpRoot, 'src', 'sidebar')
    fs.mkdirSync(srcSidebar, {recursive: true})

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

    // Both packages go in the fixture: the build takes Tailwind from the
    // project and from nowhere else.
    linkWorkspacePackage(tmpRoot, 'tailwindcss')
    linkWorkspacePackage(tmpRoot, '@tailwindcss/postcss')

    const cssFile = path.join(srcSidebar, 'sidebar-index.css')
    fs.writeFileSync(
      cssFile,
      [
        "@import 'tailwindcss';",
        '@source "../**/*.{ts,tsx,js,jsx,html}";',
        ''
      ].join('\n')
    )

    fs.writeFileSync(
      path.join(srcSidebar, 'app.tsx'),
      [
        'export function App() {',
        '  return <div className="bg-gradient-to-b from-[#1a1333] via-[#2d4065] to-[#7aafa4]" />',
        '}',
        ''
      ].join('\n')
    )

    const rule = await maybeUsePostCss(tmpRoot, {mode: 'development'})
    const plugins = (rule.options?.postcssOptions?.plugins || []) as unknown[]
    const executablePlugins = plugins.filter(
      (plugin) =>
        typeof plugin === 'function' ||
        (plugin && typeof plugin === 'object' && 'postcssPlugin' in plugin)
    )
    const tailwindPlugin = executablePlugins[0]
    expect(tailwindPlugin).toBeDefined()

    const out = await postcss([tailwindPlugin] as AcceptedPlugin[]).process(
      fs.readFileSync(cssFile, 'utf8'),
      {from: cssFile}
    )

    expect(out.css).toContain('.from-\\[\\#1a1333\\]')
    expect(out.css).toContain('--tw-gradient-stops')
    expect(out.css).toContain('.via-\\[\\#2d4065\\]')
    expect(out.css).toContain('.to-\\[\\#7aafa4\\]')
  })

  // The real Tailwind 4 says what to install. The failed search for the
  // plugin that follows would only say a module was not found.
  it('reports what Tailwind 4 itself says when its PostCSS plugin is not installed', async () => {
    fs.writeFileSync(
      path.join(tmpRoot, 'package.json'),
      JSON.stringify({
        name: 'fixture-tailwind-without-plugin',
        devDependencies: {tailwindcss: '^4.0.0'}
      })
    )

    linkWorkspacePackage(tmpRoot, 'tailwindcss')
    const warned: string[] = []

    await maybeUsePostCss(tmpRoot, {
      mode: 'development',
      warn: (message) => warned.push(message)
    })

    expect(warned).toHaveLength(1)
    expect(warned[0].split('\n')[2]).toMatch(
      /^REASON It looks like you're trying to use `tailwindcss` directly as a PostCSS plugin\./
    )
  })
})
