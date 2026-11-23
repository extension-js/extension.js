import {describe, expect, it} from 'vitest'
import {defined} from '../../__spec__/helpers/defined'
import {dropRepeatedDiagnostics} from '../one-diagnostic-per-location'

const ESCAPE = String.fromCharCode(27)

function finding(resource: string | undefined, message: string, line = 1) {
  return {
    message,
    module: resource
      ? {resource, layer: undefined as string | undefined}
      : null,
    loc: {start: {line, column: 0}}
  }
}

describe('dropRepeatedDiagnostics', () => {
  it('keeps one finding per file, place and text, whatever layer built it', () => {
    const background = finding('/p/shared.js', 'Critical dependency')
    const contentScript = finding('/p/shared.js', 'Critical dependency')
    defined(contentScript.module, 'the finding module').layer =
      'extensionjs-content-script'

    const list = [background, contentScript]

    expect(dropRepeatedDiagnostics(list)).toBe(1)
    expect(list).toEqual([background])
  })

  it('reads the text without its color codes', () => {
    const list = [
      finding('/p/shared.js', `Module ${ESCAPE}[31mnot found${ESCAPE}[39m`),
      finding('/p/shared.js', 'Module not found')
    ]

    expect(dropRepeatedDiagnostics(list)).toBe(1)
    expect(list).toHaveLength(1)
  })

  it('keeps findings that differ in file, place or text', () => {
    const list = [
      finding('/p/a.js', 'same'),
      finding('/p/b.js', 'same'),
      finding('/p/a.js', 'same', 2),
      finding('/p/a.js', 'other')
    ]

    expect(dropRepeatedDiagnostics(list)).toBe(0)
    expect(list).toHaveLength(4)
  })

  it('never merges findings that name no file', () => {
    const list = [finding(undefined, 'same'), finding(undefined, 'same')]

    expect(dropRepeatedDiagnostics(list)).toBe(0)
    expect(list).toHaveLength(2)
  })
})
