import fs from 'fs'
import path from 'path'
import {Compilation} from 'webpack'
import * as utils from '../utils'
import {Manifest, FilepathList} from '../../webpack-types'

jest.mock('fs')
jest.mock('child_process')
jest.mock('package-manager-detector')

describe('utils', () => {
  describe('getResolvedPath', () => {
    it('should return the resolved path relative to the context', () => {
      const context = '/project/src'
      const filePath = '/project/src/assets/image.png'
      const basePath = 'static'
      const result = utils.getResolvedPath(context, filePath, basePath)
      expect(result).toEqual('/static/assets/image.png')
    })
  })

  describe('isFromFilepathList', () => {
    it('should return true if the filePath is in the filepathList', () => {
      const filePath = '/project/src/assets/image.png'
      const filepathList: FilepathList = {
        image: '/project/src/assets/image.png',
        script: '/project/src/assets/script.js'
      }
      expect(utils.isFromFilepathList(filePath, filepathList)).toBe(true)
    })

    it('should return false if the filePath is not in the filepathList', () => {
      const filePath = '/project/src/assets/style.css'
      const filepathList: FilepathList = {
        image: '/project/src/assets/image.png',
        script: '/project/src/assets/script.js'
      }
      expect(utils.isFromFilepathList(filePath, filepathList)).toBe(false)
    })
  })

  describe('getFilename', () => {
    it('should return the correct filename with the appropriate extension', () => {
      const feature = 'image'
      const filePath = '/project/src/assets/image.png'
      const excludeList: FilepathList = {}
      const result = utils.getFilename(feature, filePath, excludeList)
      expect(result).toEqual('image')
    })
  })

  describe('unixify', () => {
    it('should convert a Windows path to a Unix path', () => {
      const filePath = 'C:\\project\\src\\assets\\image.png'
      const result = utils.unixify(filePath)
      expect(result).toEqual('C:/project/src/assets/image.png')
    })
  })

  describe('shouldExclude', () => {
    it('should return true if the filePath is in the ignorePatterns', () => {
      const filePath = '/project/src/assets/image.png'
      const ignorePatterns: FilepathList = {
        image: '/project/src/assets/image.png',
        script: '/project/src/assets/script.js'
      }
      expect(utils.shouldExclude(filePath, ignorePatterns)).toBe(true)
    })

    it('should return false if the filePath is not in the ignorePatterns', () => {
      const filePath = '/project/src/assets/style.css'
      const ignorePatterns: FilepathList = {
        image: '/project/src/assets/image.png',
        script: '/project/src/assets/script.js'
      }
      expect(utils.shouldExclude(filePath, ignorePatterns)).toBe(false)
    })
  })

  describe('getManifestContent', () => {
    it('should return the parsed manifest.json content from the compilation assets', () => {
      const manifestContent = {name: 'Test Extension'}
      const compilation: Partial<Compilation> = {
        getAsset: jest.fn().mockReturnValue({
          source: () => JSON.stringify(manifestContent)
        }),
        assets: {
          'manifest.json': {
            source: () => JSON.stringify(manifestContent),
            size: () => 100,
            map: () => null,
            sourceAndMap: () => {
              return {
                source: JSON.stringify(manifestContent),
                map: {}
              }
            },
            updateHash: () => {},
            buffer: () => {
              return Buffer.from(JSON.stringify(manifestContent))
            }
          }
        }
      }
      const result = utils.getManifestContent(
        compilation as Compilation,
        'manifest.json'
      )
      expect(result).toEqual(manifestContent)
    })

    it('should return the manifest content from the file if not in assets', () => {
      const compilation: Partial<Compilation> = {
        getAsset: jest.fn().mockReturnValue(undefined),
        assets: {}
      }
      const manifestPath = path.resolve(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        '..',
        'examples',
        'init',
        'manifest.json'
      )

      const result = utils.getManifestContent(
        compilation as Compilation,
        manifestPath
      )
      expect(result).toEqual(require(manifestPath))
    })
  })

  describe('getRelativePath', () => {
    it('should return the correct relative path', () => {
      const from = '/project/src/file.js'
      const to = '/project/src/assets/image.png'
      const result = utils.getRelativePath(from, to)
      expect(result).toEqual('./assets/image.png')
    })
  })

  describe('isUsingJSFramework', () => {
    it('should return true if the project uses a JS framework', () => {
      const projectPath = '/project'
      const packageJson = {
        dependencies: {react: '17.0.0'},
        devDependencies: {}
      }
      jest.spyOn(fs, 'existsSync').mockReturnValue(true)
      jest
        .spyOn(fs, 'readFileSync')
        .mockReturnValue(JSON.stringify(packageJson))

      const result = utils.isUsingJSFramework(projectPath)
      expect(result).toBe(true)
    })

    it('should return false if the project does not use a JS framework', () => {
      const projectPath = '/project'
      const packageJson = {
        dependencies: {},
        devDependencies: {}
      }
      jest.spyOn(fs, 'existsSync').mockReturnValue(true)
      jest
        .spyOn(fs, 'readFileSync')
        .mockReturnValue(JSON.stringify(packageJson))

      const result = utils.isUsingJSFramework(projectPath)
      expect(result).toBe(false)
    })
  })

  describe('isFirstRun', () => {
    it('should return true if it is the first run for the browser', () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(false)
      const result = utils.isFirstRun('chrome')
      expect(result).toBe(true)
    })

    it('should return false if it is not the first run for the browser', () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true)
      const result = utils.isFirstRun('chrome')
      expect(result).toBe(false)
    })
  })

  describe('removeManifestKeysNotFromCurrentBrowser', () => {
    it('should remove keys not from the current browser', () => {
      const manifest: Manifest = {
        name: 'Test Extension',
        version: '1.0',
        'chrome:background': {scripts: ['background.js']},
        'firefox:background': {scripts: ['background.js']}
      }
      const browser = 'chrome'
      const result = utils.removeManifestKeysNotFromCurrentBrowser(
        manifest,
        browser
      )
      expect(result).toEqual({
        name: 'Test Extension',
        version: '1.0',
        background: {scripts: ['background.js']}
      })
    })
  })

  describe('isFromPnpx', () => {
    it('should return "pnpm" if the command is from pnpm', () => {
      process.env.npm_config_user_agent = 'pnpm'
      const result = utils.isFromPnpx()
      expect(result).toBe('pnpm')
    })

    it('should return false if the command is not from pnpm', () => {
      process.env.npm_config_user_agent = 'npm'
      const result = utils.isFromPnpx()
      expect(result).toBe(false)
    })

    it('should return false if npm_config_user_agent is not set', () => {
      delete process.env.npm_config_user_agent
      const result = utils.isFromPnpx()
      expect(result).toBe(false)
    })
  })

  describe('isFromNpx', () => {
    it('should return "npm" if the command is from npx', () => {
      process.env.npm_execpath = 'npx'
      const result = utils.isFromNpx()
      expect(result).toBe('npm')
    })

    it('should return false if npm_execpath is not set', () => {
      delete process.env.npm_execpath
      const result = utils.isFromNpx()
      expect(result).toBe(false)
    })
  })
})
