import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {
  librewolfOverridesCandidates,
  librewolfRemoteDebuggingEnabled
} from '../run-firefox/firefox-launch/librewolf-overrides'

let home: string

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-librewolf-home-'))
})

afterEach(() => {
  fs.rmSync(home, {recursive: true, force: true})
})

function writeOverrides(relative: string, content: string) {
  const file = path.join(home, relative)
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, content)

  return file
}

describe('librewolfRemoteDebuggingEnabled', () => {
  it('reports the file to create when no overrides file exists', () => {
    const result = librewolfRemoteDebuggingEnabled(fs, {HOME: home}, 'darwin')

    expect(result.enabled).toBe(false)
    expect(result.expectedPath).toBe(
      path.join(home, '.librewolf', 'librewolf.overrides.cfg')
    )
  })

  it('accepts the pref line in the home overrides file', () => {
    const file = writeOverrides(
      '.librewolf/librewolf.overrides.cfg',
      'pref("devtools.debugger.remote-enabled", true);\n'
    )

    expect(librewolfRemoteDebuggingEnabled(fs, {HOME: home}, 'darwin')).toEqual(
      {enabled: true, expectedPath: file}
    )
  })

  it('accepts defaultPref and lockPref spellings and the XDG location', () => {
    const xdg = path.join(home, 'xdg')
    writeOverrides(
      'xdg/librewolf/librewolf/librewolf.overrides.cfg',
      '// comment\nlockPref( "devtools.debugger.remote-enabled" , true );\n'
    )

    expect(
      librewolfRemoteDebuggingEnabled(
        fs,
        {HOME: home, XDG_CONFIG_HOME: xdg},
        'linux'
      ).enabled
    ).toBe(true)
  })

  it('rejects a file that sets the pref to false or names another pref', () => {
    writeOverrides(
      '.librewolf/librewolf.overrides.cfg',
      'pref("devtools.debugger.remote-enabled", false);\npref("devtools.chrome.enabled", true);\n'
    )

    expect(
      librewolfRemoteDebuggingEnabled(fs, {HOME: home}, 'linux').enabled
    ).toBe(false)
  })

  it('looks under the user profile on windows', () => {
    expect(librewolfOverridesCandidates({USERPROFILE: home}, 'win32')).toEqual([
      path.join(home, '.librewolf', 'librewolf.overrides.cfg')
    ])
  })
})
