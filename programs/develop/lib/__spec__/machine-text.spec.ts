import * as path from 'node:path'
import {pathToFileURL} from 'node:url'
import {describe, expect, it} from 'vitest'
import {toMachineText} from '../machine-text'

const PROJECT = path.resolve(path.sep, 'work', 'my extension')
const PACKAGE_ROOT = path.resolve(__dirname, '..', '..')
const inProject = (...parts: string[]) => path.join(PROJECT, ...parts)

describe('toMachineText drops the terminal frame', () => {
  it('reads the head marker and every bar gutter off a warning', () => {
    const raw =
      '  ⚠ A url(./dead.png) reference points to a file that exists nowhere in the project.\n' +
      '  │ PATH popup/late.css\n' +
      '  │ NOT FOUND ./dead.png\n'

    expect(toMachineText(raw)).toBe(
      'A url(./dead.png) reference points to a file that exists nowhere in the project.\n' +
        'PATH popup/late.css\n' +
        'NOT FOUND ./dead.png'
    )
  })

  it('reads the channel glyph and the colors off a loader message', () => {
    const raw =
      '  ⚠ Module Warning (from /abs/dist/css-parse-guard-loader.mjs):\n' +
      "  │ \u001b[93m⏵⏵⏵\u001b[39m The CSS in this file doesn't parse, so it was copied as-is.\n" +
      '  │ \u001b[90mPATH\u001b[39m \u001b[4mpopup/broken.css\u001b[24m\n'

    expect(toMachineText(raw)).toBe(
      "The CSS in this file doesn't parse, so it was copied as-is.\nPATH popup/broken.css"
    )
  })

  it('keeps a bar that belongs to a code frame', () => {
    const raw =
      '  × Module build failed (from ../../tool/node_modules/sass-loader/dist/cjs/index.js):\n' +
      '  ╰─▶   × Undefined variable.\n' +
      '        │   ╷\n' +
      '        │ 1 │ .a { color: $undefined-var; }\n' +
      '        │   │             ^^^^^^^^^^^^^^\n' +
      '        │   ╵\n' +
      '        │   popup/s.scss 1:13  root stylesheet\n' +
      '      \n'

    expect(toMachineText(raw)).toBe(
      'Undefined variable.\n' +
        '  ╷\n' +
        '1 │ .a { color: $undefined-var; }\n' +
        '  │             ^^^^^^^^^^^^^^\n' +
        '  ╵\n' +
        '  popup/s.scss 1:13  root stylesheet'
    )
  })

  it('reads the loader path off a failed module build', () => {
    const loader = path.join(
      PACKAGE_ROOT,
      'node_modules',
      'sass-loader',
      'dist',
      'cjs.js'
    )

    expect(
      toMachineText(`  × Module build failed (from ${loader}):\n  │ Broke.\n`)
    ).toBe('Broke.')
  })

  it('leaves a message with no frame as written', () => {
    expect(toMachineText('default_locale is set.\nAdd the folder.')).toBe(
      'default_locale is set.\nAdd the folder.'
    )
  })
})

describe('toMachineText prints a path the reader can open', () => {
  it('names a file inside the project from the project root', () => {
    const raw =
      "  ⚠ The page references an asset that doesn't exist.\n" +
      `  │ PATH ${inProject('popup', 'index.html')}\n` +
      `  │ NOT FOUND ${inProject('popup', 'gone.png')}\n` +
      `  │ Update the ${inProject('popup', 'gone.png')} reference to point to a file that exists.\n`

    expect(toMachineText(raw, PROJECT)).toBe(
      "The page references an asset that doesn't exist.\n" +
        'PATH popup/index.html\n' +
        'NOT FOUND popup/gone.png\n' +
        'Update the popup/gone.png reference to point to a file that exists.'
    )
  })

  it('keeps a path outside the project in its real form', () => {
    const outside = path.resolve(path.sep, 'work', 'shared', 'theme.css')
    const sibling = `${PROJECT}-two${path.sep}a.css`

    expect(toMachineText(`NOT FOUND ${outside}`, PROJECT)).toBe(
      `NOT FOUND ${outside}`
    )

    expect(toMachineText(`NOT FOUND ${sibling}`, PROJECT)).toBe(
      `NOT FOUND ${sibling}`
    )
  })

  it('leaves a longer path that only ends like the project alone', () => {
    const nested = path.join(path.sep, 'mnt', PROJECT, 'a.css')

    expect(toMachineText(`PATH ${nested}`, PROJECT)).toBe(`PATH ${nested}`)
  })

  it('names a toolchain dependency by its package and never its folder', () => {
    const dependency = path.join(
      PACKAGE_ROOT,
      '..',
      '..',
      'node_modules',
      '.pnpm',
      'sass-loader@16.0.0',
      'node_modules',
      'sass-loader',
      'dist',
      'cjs.js'
    )

    expect(toMachineText(`Thrown at ${dependency}:12:3`, PROJECT)).toBe(
      'Thrown at sass-loader/dist/cjs.js:12:3'
    )
  })

  it('names a file of this package by the published package name', () => {
    const own = path.join(PACKAGE_ROOT, 'dist', 'late-css-import-loader.mjs')

    expect(
      toMachineText(`Thrown at ${pathToFileURL(own).href}:43:47`, PROJECT)
    ).toBe('Thrown at extension-develop/dist/late-css-import-loader.mjs:43:47')
  })
})
