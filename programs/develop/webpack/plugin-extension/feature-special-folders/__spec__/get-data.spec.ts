import {describe, it, expect, vi} from 'vitest'
import {getSpecialFoldersDataForCompiler} from '../get-data'

const getSpecialFoldersDataMock = vi.fn()

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
})
