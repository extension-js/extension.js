import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// A one-shot development build runs compiler.run(), so the frameworks plugin
// must finish configuring SWC before the first module is parsed: a TypeScript
// content script otherwise reaches the JS parser untranspiled.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-dev-ts-content-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      private: true,
      name: 'dev-ts-content',
      version: '0.0.0',
      devDependencies: {typescript: '5.4.5'}
    })
  )
  fs.writeFileSync(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({compilerOptions: {strict: true, target: 'ES2020'}})
  )
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'dev-ts-content',
      version: '1.0.0',
      content_scripts: [{matches: ['<all_urls>'], js: ['content.ts']}]
    })
  )
  fs.writeFileSync(
    path.join(root, 'content.ts'),
    'interface Marker {label: string}\nconst marker: Marker = {label: "ts-content"}\nconsole.log(marker.label satisfies string)\n'
  )
  return root
}

describe('one-shot development build with a TypeScript content script', () => {
  it('transpiles the content script before the parser sees it', async () => {
    const root = project()
    const {extensionBuild} = await import('../command-build')
    const previous = process.env.VITEST
    process.env.VITEST = 'true'
    const lines: string[] = []
    const originalStderr = process.stderr.write.bind(process.stderr)
    const originalError = console.error
    const originalLog = console.log
    process.stderr.write = ((chunk: unknown) => {
      lines.push(String(chunk))
      return true
    }) as typeof process.stderr.write
    console.error = (...args: unknown[]) => lines.push(args.join(' '))
    console.log = (...args: unknown[]) => lines.push(args.join(' '))
    try {
      const summary = await extensionBuild(root, {
        browser: 'chrome',
        silent: false,
        install: false,
        mode: 'development',
        exitOnError: false
      } as any)
      expect(summary.errors_count, lines.join('\n')).toBe(0)
    } catch (error) {
      throw new Error(`build failed: ${String(error)}\n${lines.join('\n')}`)
    } finally {
      process.stderr.write = originalStderr
      console.error = originalError
      console.log = originalLog
      if (previous === undefined) delete process.env.VITEST
      else process.env.VITEST = previous
    }
    const distDir = path.join(root, 'dist', 'chrome')
    const bundles = fs
      .readdirSync(distDir, {recursive: true})
      .map(String)
      .filter((file) => file.endsWith('.js'))
      .map((file) => fs.readFileSync(path.join(distDir, file), 'utf8'))
    const bundle = bundles.find((code) => code.includes('ts-content'))
    expect(bundle, bundles.length.toString()).toBeDefined()
    expect(bundle).not.toContain('interface Marker')
  }, 120_000)
})
