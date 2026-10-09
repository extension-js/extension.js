import {afterEach, describe, expect, it} from 'vitest'
import {usingTemplate} from '../messages'

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
const plain = (text: string) => text.replace(ANSI, '')
const CODELOAD =
  'https://codeload.github.com/extension-js/examples/zip/d69e46b311c27d11a98d241494023101b337281f'
const DEBUG_KEY = 'EXTENSION_DEBUG' as string
const savedDebug = process.env[DEBUG_KEY]

afterEach(() => {
  if (savedDebug === undefined) delete process.env[DEBUG_KEY]
  else process.env.EXTENSION_DEBUG = savedDebug
})

describe('usingTemplate', () => {
  it('names the repository a downloaded template came from, not its archive url', () => {
    delete process.env[DEBUG_KEY]
    const line = plain(usingTemplate('init', CODELOAD))

    expect(line).toContain(
      'Using the init template, from extension-js/examples.'
    )

    expect(line).not.toContain('codeload')
    expect(line).not.toContain('d69e46b')
  })

  it('shortens a github.com url the user passed to its owner and repo', () => {
    delete process.env[DEBUG_KEY]
    expect(
      plain(usingTemplate('x', 'https://github.com/acme/starter.git'))
    ).toContain('from acme/starter.')
  })

  it('keeps the full source under debug output', () => {
    process.env.EXTENSION_DEBUG = '1'
    expect(plain(usingTemplate('init', CODELOAD))).toContain(
      `from extension-js/examples (${CODELOAD}).`
    )
  })

  it('leaves the bundled and local wording alone', () => {
    process.env.EXTENSION_DEBUG = '1'
    expect(plain(usingTemplate('javascript', 'bundled'))).toContain(
      'Using the javascript template, bundled with this CLI.'
    )

    expect(plain(usingTemplate('mine', 'local'))).toContain(
      'from a directory on this machine.'
    )
  })
})
