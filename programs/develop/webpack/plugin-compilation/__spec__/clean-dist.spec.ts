import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
const FS = vi.hoisted(() => ({
  existsSync: vi.fn(),
  rmSync: vi.fn()
}))
vi.mock('fs', () => ({
  ...FS
}))
import * as fs from 'fs'
import * as path from 'path'
import {CleanDistFolderPlugin} from '../clean-dist'

describe('CleanDistFolderPlugin', () => {
  const realExists = fs.existsSync
  const realRmSync = fs.rmSync

  beforeEach(() => {
    vi.restoreAllMocks()
    ;(fs.existsSync as any).mockImplementation((p: any) => realExists(p))
    ;(fs.rmSync as any).mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('removes dist/<browser> folder if it exists', () => {
    const distPath = path.join(process.cwd(), 'dist', 'chrome')
    vi.mocked(fs.existsSync).mockReturnValue(true as any)

    const plugin = new CleanDistFolderPlugin({browser: 'chrome'})

    const compiler: any = {
      options: {context: process.cwd()}
    }

    plugin.apply(compiler)

    expect(fs.rmSync).toHaveBeenCalledWith(distPath, {
      recursive: true,
      force: true
    })
  })

  it('does nothing if dist/<browser> does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false as any)

    const plugin = new CleanDistFolderPlugin({browser: 'firefox'})
    const compiler: any = {options: {context: process.cwd()}}

    plugin.apply(compiler)

    expect(fs.rmSync).not.toHaveBeenCalled()
  })
})
