import {describe, expect, it} from 'vitest'
import {buildWarningsDetails} from '../messages'

describe('buildWarningsDetails', () => {
  it('drops the rspack loader wrapper and keeps the message', () => {
    const out = buildWarningsDetails([
      {
        message:
          'Module Warning (from /abs/path/late-css-import-loader.mjs):\n' +
          'An @import rule comes after other rules, so browsers skip it.\n' +
          'PATH popup/popup.css:3',
        moduleName: './popup/popup.css'
      }
    ])
    expect(out).not.toContain('Module Warning')
    expect(out).not.toContain('late-css-import-loader.mjs')
    expect(out).toContain('An @import rule comes after other rules')
    expect(out).toContain('popup/popup.css:3')
    expect(out).toContain('./popup/popup.css')
  })

  it('leaves warnings without the wrapper untouched', () => {
    const out = buildWarningsDetails(['plain warning text'])
    expect(out).toContain('plain warning text')
  })
})
