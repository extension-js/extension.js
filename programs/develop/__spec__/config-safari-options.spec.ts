import {describe, expect, it} from 'vitest'
import type {FileConfig} from '../types'

// The compile IS the assertion: the documented safari identity options must
// type-check in extension.config.js command blocks, not only under browser.*.
describe('FileConfig safari command options', () => {
  it('accepts safari identity options in commands.dev and commands.build', () => {
    const config: FileConfig = {
      browser: {
        safari: {
          browser: 'webkit-based',
          safariBinary: '/Applications/Safari Technology Preview.app',
          appName: 'My App',
          bundleId: 'com.example.my-app',
          macOsOnly: true
        }
      },
      commands: {
        dev: {
          browser: 'safari',
          safariBinary: '/Applications/Safari.app',
          appName: 'My App',
          bundleId: 'com.example.my-app',
          macOsOnly: true
        },
        build: {
          browser: 'safari',
          safariBinary: '/Applications/Safari.app',
          appName: 'My App',
          bundleId: 'com.example.my-app',
          macOsOnly: false
        }
      }
    }

    expect(config.commands?.dev?.bundleId).toBe('com.example.my-app')
    expect(config.commands?.dev?.safariBinary).toBe('/Applications/Safari.app')
    expect(config.commands?.build?.appName).toBe('My App')
    expect(config.commands?.build?.macOsOnly).toBe(false)
  })
})
