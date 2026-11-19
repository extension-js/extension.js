import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {rspack, type Stats} from '@rspack/core'
import {afterAll, describe, expect, it} from 'vitest'
import {compilationDiagnostics} from '../compilation-diagnostics'
import {toMachineText} from '../machine-text'
import {unwrapNamedCauses} from '../named-cause'
import {renderStatsBlocks} from '../stats-handler'

// eslint-disable-next-line no-control-regex
const plain = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '')

const refusal = (loader: string, name = 'ReservedScriptsFolder') =>
  `  × Module build failed (from ${loader}):\n` +
  `  ╰─▶   × ${name}: ⏵⏵⏵ scripts/ is a reserved folder in Extension.js.\n` +
  '        │ PATH scripts/tool.js\n' +
  "        │ - import from the 'node:' protocol\n" +
  '        │     at Object.contentScriptWrapper (file:///abs/dist/wrapper.mjs:398:33)\n' +
  '        │     at new Promise (<anonymous>)\n' +
  '        │     at node:internal/util:492:21\n'

describe('unwrapNamedCauses in the terminal', () => {
  it('prints only the message of a cause the diagnostic table names', () => {
    expect(unwrapNamedCauses(refusal('../dist/outer-loader.mjs'))).toBe(
      '  × scripts/ is a reserved folder in Extension.js.\n' +
        '    PATH scripts/tool.js\n' +
        "    - import from the 'node:' protocol\n"
    )
  })

  it('keeps the stack frames when asked to', () => {
    const out = unwrapNamedCauses(refusal('../dist/outer-loader.mjs'), {
      keepStack: true
    })

    expect(out).not.toContain('Module build failed')
    expect(out).toContain('      at new Promise (<anonymous>)')
  })

  it('matches a Windows loader path in the head line', () => {
    const out = unwrapNamedCauses(
      refusal(
        'C:\\Users\\me\\proj\\node_modules\\extension-develop\\dist\\outer-loader.mjs'
      )
    )

    expect(out.split('\n')[0]).toBe(
      '  × scripts/ is a reserved folder in Extension.js.'
    )
  })

  it('unwraps a failed build nested inside another', () => {
    const raw =
      '  × Module build failed (from ../dist/outer.mjs):\n' +
      '  ╰─▶ × Module build failed (from ../dist/inner.mjs):\n' +
      '      ╰─▶ × ContentScriptSyntax: This content script has a default export.\n' +
      '          │ PATH content.js\n'

    expect(unwrapNamedCauses(raw)).toBe(
      '  × This content script has a default export.\n    PATH content.js\n'
    )
  })

  it('keeps the color of the glyph and of the message', () => {
    const raw =
      '  \u001b[31m×\u001b[0m Module build failed \u001b[2m(from ../dist/outer.mjs)\u001b[0m:\n' +
      '  \u001b[2m  ╰─▶ \u001b[0m  \u001b[31m×\u001b[0m ReservedScriptsFolder: \u001b[31m⏵⏵⏵\u001b[39m scripts/ is reserved.\n' +
      '        \u001b[2m│\u001b[0m \u001b[90mPATH\u001b[39m scripts/tool.js'
    const out = unwrapNamedCauses(raw)

    expect(out.startsWith('  \u001b[31m×\u001b[0m ')).toBe(true)
    expect(out).toContain('\u001b[90mPATH\u001b[39m')
    expect(plain(out)).toBe(
      '  × scripts/ is reserved.\n    PATH scripts/tool.js'
    )
  })

  it('leaves a cause with an unknown name exactly as written', () => {
    const raw = refusal('../dist/outer-loader.mjs', 'SomeOtherError')

    expect(unwrapNamedCauses(raw)).toBe(raw)
  })

  it('leaves a cause with no name exactly as written', () => {
    const raw =
      'Module build failed (from builtin:swc-loader):\n' +
      '  ╰─▶   × Syntax Error: Expression expected\n' +
      '          ╭─[82:15]\n'

    expect(unwrapNamedCauses(raw)).toBe(raw)
  })
})

describe('toMachineText on a named cause', () => {
  it('reads only the message, with no loader, name or stack', () => {
    expect(toMachineText(refusal('/abs/dist/outer-loader.mjs'))).toBe(
      'scripts/ is a reserved folder in Extension.js.\n' +
        'PATH scripts/tool.js\n' +
        "- import from the 'node:' protocol"
    )
  })

  it('reads an unknown name the way it did before', () => {
    expect(
      toMachineText(refusal('/abs/dist/outer-loader.mjs', 'SomeOtherError'))
    ).toMatch(/^SomeOtherError: ⏵⏵⏵ scripts\/ is a reserved folder/)
  })
})

describe('a named refusal from a real loader chain', () => {
  const roots: string[] = []

  afterAll(() => {
    for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
  })

  function compileWithRefusal(name: string) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-named-cause-'))
    roots.push(root)
    fs.writeFileSync(path.join(root, 'index.js'), 'export const value = 1\n')
    fs.writeFileSync(
      path.join(root, 'outer-loader.cjs'),
      'module.exports = function (source) { return source }\n'
    )

    fs.writeFileSync(
      path.join(root, 'refusing-loader.cjs'),
      'module.exports = function () {\n' +
        `  throw Object.assign(new Error('This file is refused.\\nPATH index.js'), {name: ${JSON.stringify(name)}})\n` +
        '}\n'
    )

    const compiler = rspack({
      context: root,
      mode: 'development',
      entry: './index.js',
      output: {path: path.join(root, 'out')},
      module: {
        rules: [
          {
            test: /index\.js$/,
            use: [
              path.join(root, 'outer-loader.cjs'),
              path.join(root, 'refusing-loader.cjs')
            ]
          }
        ]
      }
    })

    return new Promise<Stats>((resolve, reject) => {
      compiler.run((error, stats) => {
        compiler.close(() => {
          if (error || !stats) return reject(error || new Error('no stats'))

          resolve(stats)
        })
      })
    })
  }

  it('prints and reports only the message of a named refusal', async () => {
    const stats = await compileWithRefusal('ReservedScriptsFolder')
    const printed = plain(
      renderStatsBlocks(stats, {errors: true, warnings: false})
    )
    const [detail] = compilationDiagnostics(stats.compilation).details

    expect(printed).not.toContain('Module build failed')
    expect(printed).not.toContain('outer-loader')
    expect(printed).not.toContain('ReservedScriptsFolder')
    expect(printed).toContain('× This file is refused.')
    expect(detail.message).toBe('This file is refused.\nPATH index.js')
    expect(detail.code).toBe('E_RESERVED_FOLDER')
  }, 60_000)

  it('prints an unnamed refusal with the head line as before', async () => {
    const stats = await compileWithRefusal('Error')
    const printed = plain(
      renderStatsBlocks(stats, {errors: true, warnings: false})
    )

    expect(printed).toContain('Module build failed')
  }, 60_000)
})
