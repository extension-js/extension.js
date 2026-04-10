import {describe, it, expect} from 'vitest'
import * as path from 'path'
import {
  CERTIFICATE_DESTINATION_PATH,
  CHROMIUM_BASED_BROWSERS,
  GECKO_BASED_BROWSERS,
  SUPPORTED_BROWSERS
} from '../constants'

describe('constants', () => {
  it('exports certificate path under node_modules/extension-develop/dist/certs', () => {
    expect(
      CERTIFICATE_DESTINATION_PATH.endsWith(
        path.join('node_modules', 'extension-develop', 'dist', 'certs')
      )
    ).toBe(true)
  })

  it('lists chromium and gecko based browsers and union', () => {
    expect(CHROMIUM_BASED_BROWSERS).toEqual(['chrome', 'edge'])
    expect(GECKO_BASED_BROWSERS).toEqual(['firefox'])
    expect(SUPPORTED_BROWSERS).toEqual(['chrome', 'edge', 'firefox'])
  })
})
