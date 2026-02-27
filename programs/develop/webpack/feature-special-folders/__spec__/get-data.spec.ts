import {describe, it, expect, vi} from 'vitest'
import * as fs from 'fs'
import {getSpecialFoldersDataForCompiler} from '../get-data'

const getSpecialFoldersDataMock = vi.fn()

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
    statSync: vi.fn(actual.statSync)
  }
})

vi.mock('browser-extension-manifest-fields', () => ({
  getSpecialFoldersData: (...args: any[]) => getSpecialFoldersDataMock(...args)
}))

describe('getSpecialFoldersDataForCompiler', () => {
  it('filters out public/ entries from pages and scripts', () => {
    getSpecialFoldersDataMock.mockReturnValue({
      pages: {
        'page-a': '/project/pages/a.html',
        'page-b': '/project/public/sample/pages/b.html',
        'page-c': 'public/sample/pages/c.html',
        'page-d': 'pages/d.html'
      },
      scripts: {
        'scripts/a': [
          '/project/scripts/a.js',
          '/project/public/sample/scripts/b.js',
          'public/sample/scripts/c.js'
        ]
      },
      public: {foo: 'bar'}
    })

    const compiler = {options: {context: '/project'}} as any
    const data = getSpecialFoldersDataForCompiler(compiler)

    expect(Object.values(data.pages || {})).toEqual([
      '/project/pages/a.html',
      'pages/d.html'
    ])
    expect(data.scripts?.['scripts/a']).toEqual(['/project/scripts/a.js'])
    expect((data as any).public).toEqual({foo: 'bar'})
  })

  it('auto-configures companion extensions scan from extensions/', () => {
    getSpecialFoldersDataMock.mockReturnValue({
      pages: {},
      scripts: {},
      public: {}
    })
    const existsSpy = vi.mocked(fs.existsSync).mockReturnValue(true as any)
    const statSpy = vi
      .mocked(fs.statSync)
      .mockReturnValue({isDirectory: () => true} as any)

    const compiler = {options: {context: '/project'}} as any
    const data = getSpecialFoldersDataForCompiler(compiler)

    expect(data.extensions).toEqual({dir: './extensions'})

    existsSpy.mockReset()
    statSpy.mockReset()
  })
})
