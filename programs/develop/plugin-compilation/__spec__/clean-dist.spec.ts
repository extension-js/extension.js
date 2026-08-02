import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

vi.mock('fs', async () => {
  const actual: any = await vi.importActual('fs')
  return {
    ...actual,
    rmSync: vi.fn(),
    existsSync: vi.fn()
  }
})

import * as fs from 'node:fs'
import * as path from 'node:path'
import {CleanDistFolderPlugin} from '../clean-dist'

describe('CleanDistFolderPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function compilerWithContext(
    context: string,
    logger?: {
      info: (...a: any[]) => void
      warn: (...a: any[]) => void
      error: (...a: any[]) => void
    },
    outputPath?: string
  ) {
    const l =
      logger ||
      ({
        info: () => {},
        warn: () => {},
        error: () => {}
      } as any)
    return {
      options: {context, output: outputPath ? {path: outputPath} : {}},
      getInfrastructureLogger: () => l
    } as any
  }

  it('removes dist/<browser> when it exists', () => {
    ;(fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      true
    )
    const rm = fs.rmSync as unknown as ReturnType<typeof vi.fn>
    rm.mockImplementation(() => {})
    const plugin = new CleanDistFolderPlugin({browser: 'chrome'})
    plugin.apply(compilerWithContext('/proj'))

    expect(rm).toHaveBeenCalledWith(path.join('/proj', 'dist', 'chrome'), {
      recursive: true,
      force: true
    })
  })

  it('logs a friendly message in development', () => {
    ;(fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      true
    )
    ;(fs.rmSync as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () => {}
    )
    const info = vi.fn()
    const plugin = new CleanDistFolderPlugin({browser: 'edge'})
    process.env.EXTENSION_AUTHOR_MODE = 'true'
    plugin.apply(
      compilerWithContext('/p', {info, warn: vi.fn(), error: vi.fn()})
    )
    delete process.env.EXTENSION_AUTHOR_MODE
    expect(info).toHaveBeenCalled()
  })

  it('handles removal errors gracefully', () => {
    ;(fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      true
    )
    ;(fs.rmSync as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () => {
        throw new Error('boom')
      }
    )
    const err = vi.fn()
    const plugin = new CleanDistFolderPlugin({browser: 'firefox'})
    plugin.apply(
      compilerWithContext('/x', {info: vi.fn(), warn: vi.fn(), error: err})
    )
    expect(err).toHaveBeenCalled()
  })

  it('cleans the configured output.path, not <context>/dist/<browser>', () => {
    ;(fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      true
    )
    const rm = fs.rmSync as unknown as ReturnType<typeof vi.fn>
    rm.mockImplementation(() => {})
    const plugin = new CleanDistFolderPlugin({browser: 'chrome'})
    plugin.apply(
      compilerWithContext('/proj', undefined, '/custom/out/chrome-build')
    )

    expect(rm).toHaveBeenCalledWith('/custom/out/chrome-build', {
      recursive: true,
      force: true
    })
    expect(rm).not.toHaveBeenCalledWith(
      path.join('/proj', 'dist', 'chrome'),
      expect.anything()
    )
  })

  it('never touches the live dist when emitting into a staging sibling', () => {
    const liveDist = path.join('/proj', 'dist', 'chrome')
    const stagingDist = path.join(
      '/proj',
      'dist',
      '.extension-build-chrome-abc123'
    )
    ;(fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (target: string) => target === liveDist
    )
    const rm = fs.rmSync as unknown as ReturnType<typeof vi.fn>
    rm.mockImplementation(() => {})
    const plugin = new CleanDistFolderPlugin({browser: 'chrome'})
    plugin.apply(compilerWithContext('/proj', undefined, stagingDist))

    // The staging dir does not exist yet and the live last-good dist must
    // survive until the successful build is promoted over it.
    expect(rm).not.toHaveBeenCalled()
  })

  it('does nothing when folder does not exist', () => {
    ;(fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      false
    )
    const rm = fs.rmSync as unknown as ReturnType<typeof vi.fn>
    rm.mockImplementation(() => {})
    const plugin = new CleanDistFolderPlugin({browser: 'chrome'})
    plugin.apply(compilerWithContext('/proj'))
    expect(rm).not.toHaveBeenCalled()
  })
})
