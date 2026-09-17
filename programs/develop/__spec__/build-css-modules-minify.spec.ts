import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// A CSS module can declare a class no script imports yet. Production keeps
// every rule development keeps, so the minimizer may not delete that class,
// and the sheet must still ship minified with no fallback warning.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

const MODULE_CSS =
  '.badge {\n  color: red;\n  margin: 0;\n}\n\n.spare {\n  color: blue;\n  border-radius: 6px;\n}\n'

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-css-modules-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'modules', version: '0.0.0'})
  )

  fs.writeFileSync(path.join(root, 'styles.module.css'), MODULE_CSS)
  fs.writeFileSync(
    path.join(root, 'content.js'),
    "import {badge} from './styles.module.css'\nexport default function initial() {\n  document.body.className = badge\n}\n"
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'modules',
      version: '1.0.0',
      content_scripts: [{matches: ['<all_urls>'], js: ['content.js']}]
    })
  )

  return root
}

async function build(root: string, mode: 'development' | 'production') {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'
  let summary: Awaited<ReturnType<typeof extensionBuild>>

  try {
    summary = await extensionBuild(root, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode,
      exitOnError: false
    } as any)

    expect(summary.errors_count).toBe(0)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }

  const distDir = path.join(root, 'dist', 'chrome')
  // Windows lists nested entries with backslashes; the assertions join posix.
  const files = fs
    .readdirSync(distDir, {recursive: true})
    .map((file) => String(file).split(path.sep).join('/'))
  const sheetName = files.find((file) => file.endsWith('.css'))
  expect(sheetName, files.join(',')).toBeDefined()
  const sheet = fs.readFileSync(path.join(distDir, String(sheetName)), 'utf8')

  return {sheet, summary}
}

describe('a CSS module class no script imports survives minification', () => {
  it('ships the sheet minified with every rule and no warning', async () => {
    const dev = await build(project(), 'development')
    const prod = await build(project(), 'production')

    expect(dev.sheet).toContain('border-radius')
    // The spare rule is still there, and the sheet was really minified.
    expect(prod.sheet).toContain('border-radius:6px')
    expect(prod.sheet).toContain('margin:0')
    expect(prod.sheet.match(/\{/g)).toHaveLength(2)
    expect(prod.sheet).not.toContain('\n  ')
    expect(prod.sheet.length).toBeLessThan(dev.sheet.length)

    const warnings = prod.summary.warnings || []
    expect(warnings, warnings.join('\n---\n')).toHaveLength(0)
    expect(prod.summary.warnings_count).toBe(0)
  }, 180_000)
})
