import {describe, it, expect, vi, beforeEach} from 'vitest'
import {getLocales} from '../get-locales'
import * as fs from 'fs'
import * as path from 'path'

vi.mock('fs')
vi.mock('path')

describe('getLocales', () => {
  let existsSyncSpy: any
  let readdirSyncSpy: any
  let statSyncSpy: any
  let joinSpy: any
  let dirnameSpy: any

  beforeEach(() => {
    vi.clearAllMocks()

    existsSyncSpy = vi.spyOn(fs, 'existsSync')
    readdirSyncSpy = vi.spyOn(fs, 'readdirSync')
    statSyncSpy = vi.spyOn(fs, 'statSync')
    joinSpy = vi
      .spyOn(path, 'join')
      .mockImplementation((...args) => args.join('/'))
    dirnameSpy = vi.spyOn(path, 'dirname').mockImplementation((filePath) => {
      const parts = filePath.split('/')
      parts.pop()
      return parts.join('/')
    })
  })

  it('should return undefined if locales folder does not exist', () => {
    existsSyncSpy.mockReturnValue(false)

    const result = getLocales('manifest.json')

    expect(result).toBeUndefined()
    expect(existsSyncSpy).toHaveBeenCalledWith('/_locales')
  })

  it('should return empty array if locales folder is empty', () => {
    existsSyncSpy.mockReturnValue(true)
    readdirSyncSpy.mockReturnValue([])

    const result = getLocales('manifest.json')

    expect(result).toEqual([])
    expect(existsSyncSpy).toHaveBeenCalledWith('/_locales')
    expect(readdirSyncSpy).toHaveBeenCalledWith('/_locales')
  })

  it('should find locale files in nested directories', () => {
    existsSyncSpy.mockReturnValue(true)
    readdirSyncSpy
      .mockReturnValueOnce(['en', 'es']) // First call: locale directories
      .mockReturnValueOnce(['messages.json']) // Second call: en files
      .mockReturnValueOnce(['messages.json']) // Third call: es files
    statSyncSpy.mockReturnValue({isDirectory: () => true})

    const result = getLocales('manifest.json')

    expect(result).toEqual([
      '/_locales/en/messages.json',
      '/_locales/es/messages.json'
    ])
    expect(existsSyncSpy).toHaveBeenCalledWith('/_locales')
    expect(readdirSyncSpy).toHaveBeenCalledTimes(3)
    expect(statSyncSpy).toHaveBeenCalledTimes(2)
  })

  it('should skip non-directory entries in locales folder', () => {
    existsSyncSpy.mockReturnValue(true)
    readdirSyncSpy
      .mockReturnValueOnce(['en', 'file.txt']) // First call: locale directories
      .mockReturnValueOnce(['messages.json']) // Second call: en files
    statSyncSpy
      .mockReturnValueOnce({isDirectory: () => true}) // en is a directory
      .mockReturnValueOnce({isDirectory: () => false}) // file.txt is not a directory

    const result = getLocales('manifest.json')

    expect(result).toEqual(['/_locales/en/messages.json'])
    expect(existsSyncSpy).toHaveBeenCalledWith('/_locales')
    expect(readdirSyncSpy).toHaveBeenCalledTimes(2)
    expect(statSyncSpy).toHaveBeenCalledTimes(2)
  })
})
