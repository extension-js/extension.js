import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {rspack} from '@rspack/core'
import {afterAll, describe, expect, it} from 'vitest'
import {ScriptsPlugin} from '../index'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

// A project reached through a link, the way a Windows short folder name
// such as RUNNER~1 reaches it: the path as written is not the real one.
function linkedProject() {
  const real = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-written-path-'))
  )
  roots.push(real)

  const files: Record<string, string> = {
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'written',
      version: '1.0.0',
      content_scripts: [
        {matches: ['<all_urls>'], js: ['content/isolated.js']},
        {matches: ['<all_urls>'], js: ['content/main.js'], world: 'MAIN'}
      ]
    }),
    'content/isolated.js': 'export default function main() {}\n',
    'content/main.js': 'export default function main() {}\n'
  }

  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(real, 'project', name)), {
      recursive: true
    })

    fs.writeFileSync(path.join(real, 'project', name), text)
  }

  const written = path.join(real, 'written')
  fs.symlinkSync(path.join(real, 'project'), written, 'junction')

  return written
}

function matches(condition: unknown, value: string): boolean {
  if (condition instanceof RegExp) return condition.test(value)
  if (Array.isArray(condition)) return condition.some((c) => matches(c, value))

  return false
}

describe('script rules on a project path as written', () => {
  it('wraps a content script and spots a MAIN world importer spelled that way', async () => {
    const root = linkedProject()
    const at = (name: string) => path.join(root, name)
    const compiler = rspack({
      context: root,
      mode: 'production',
      entry: {},
      output: {path: at('dist')},
      plugins: [
        new ScriptsPlugin({
          manifestPath: at('manifest.json'),
          browser: 'chrome',
          includeList: {
            'content_scripts/content-0': [at('content/isolated.js')],
            'content_scripts/content-1': [at('content/main.js')]
          }
        })
      ]
    })
    const rules = compiler.options.module.rules as unknown as Array<{
      use?: Array<{loader?: unknown}>
      include?: unknown
      issuer?: {not: RegExp}
    } | null>
    const wrapperRules = rules.filter(
      (rule) =>
        rule !== null &&
        Array.isArray(rule.use) &&
        rule.use.some((use) =>
          String(use.loader).includes('content-script-wrapper')
        )
    )

    await new Promise<void>((resolve) => compiler.close(() => resolve()))

    const plain = wrapperRules.find((rule) => rule?.issuer?.not)

    expect(plain).toBeDefined()
    if (!plain?.issuer) throw new Error('no wrapper rule with an issuer')

    expect(matches(plain.include, at('content/isolated.js'))).toBe(true)
    expect(plain.issuer.not.test(at('content/main.js'))).toBe(true)
  })
})
