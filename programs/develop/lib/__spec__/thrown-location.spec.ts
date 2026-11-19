import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {pathToFileURL} from 'node:url'
import {afterAll, describe, expect, it} from 'vitest'
import {thrownFrom} from '../thrown-location'

const root = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-thrown-location-'))
)

afterAll(() => {
  fs.rmSync(root, {recursive: true, force: true})
})

const inProject = (...parts: string[]) => path.join(root, ...parts)

function errorWithStack(...frames: string[]): Error {
  const error = new Error('')

  error.stack = ['Error', ...frames.map((frame) => `    at ${frame}`)].join(
    '\n'
  )

  return error
}

describe('thrownFrom', () => {
  it('names the first frame in the project, from the project root', () => {
    const error = errorWithStack(
      `helper (${inProject('node_modules', 'dep', 'index.js')}:9:1)`,
      'node:internal/modules/cjs/loader:1554:14',
      `Object.apply (${inProject('plugins', 'mine.js')}:3:11)`,
      `${inProject('extension.config.js')}:8:2`
    )

    expect(thrownFrom(error, root)).toBe('plugins/mine.js:3:11')
  })

  it('reads a frame with no function name and a file URL', () => {
    const plain = errorWithStack(`${inProject('extension.config.js')}:8:2`)
    const url = errorWithStack(
      `async run (${pathToFileURL(inProject('extension.config.mjs')).href}:4:7)`
    )

    expect(thrownFrom(plain, root)).toBe('extension.config.js:8:2')
    expect(thrownFrom(url, root)).toBe('extension.config.mjs:4:7')
  })

  it('reads a folder name that holds parentheses', () => {
    const file = inProject('tools (old)', 'plugin.js')

    expect(thrownFrom(errorWithStack(`apply (${file}:2:5)`), root)).toBe(
      'tools (old)/plugin.js:2:5'
    )
  })

  it('falls back to the first file frame when none is in the project', () => {
    const outside = path.join(path.dirname(root), 'elsewhere', 'tool.js')
    const error = errorWithStack(
      'node:internal/process/task_queues:105:5',
      `run (${outside}:1:2)`
    )

    expect(thrownFrom(error, root)).toBe(`${outside}:1:2`)
  })

  it('answers nothing for a value with no stack to read', () => {
    expect(thrownFrom({}, root)).toBeUndefined()
    expect(thrownFrom(undefined, root)).toBeUndefined()
    expect(thrownFrom(errorWithStack(), root)).toBeUndefined()
  })
})
