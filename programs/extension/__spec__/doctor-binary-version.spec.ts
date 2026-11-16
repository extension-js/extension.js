import * as fs from 'node:fs'
import * as os from 'node:os'
import path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {binaryDetailSuffix} from '../commands/doctor'

describe('doctor binary line for a Firefox that updated in place', () => {
  let root = ''

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-binary-'))
  })

  afterEach(() => {
    fs.rmSync(root, {recursive: true, force: true})
  })

  function install(label: string, version: string | undefined, mac: boolean) {
    const base = path.join(root, label)
    const binDir = mac
      ? path.join(base, 'Firefox Nightly.app', 'Contents', 'MacOS')
      : path.join(base, 'firefox')
    const iniDir = mac
      ? path.join(base, 'Firefox Nightly.app', 'Contents', 'Resources')
      : binDir
    const binary = path.join(binDir, 'firefox')

    fs.mkdirSync(binDir, {recursive: true})
    fs.mkdirSync(iniDir, {recursive: true})
    fs.writeFileSync(binary, '')

    if (version) {
      fs.writeFileSync(
        path.join(iniDir, 'application.ini'),
        `[App]\nName=Firefox\nVersion=${version}\nBuildID=20261009095351\n`
      )
    }

    return binary
  }

  it('adds the version the install reports when the folder names an older one', () => {
    const binary = install('mac_arm-nightly_158.0a1', '160.0a1', true)

    expect(binaryDetailSuffix({binary, binaryProvenance: 'managed'})).toBe(
      `, ${binary}, which reports version 160.0a1 (managed)`
    )
  })

  it('reads application.ini beside the binary on Linux and Windows layouts', () => {
    const binary = install('linux-stable_140.0', '142.0.1', false)

    expect(binaryDetailSuffix({binary})).toBe(
      `, ${binary}, which reports version 142.0.1`
    )
  })

  it('adds nothing when the folder already names the version', () => {
    const binary = install('mac_arm-nightly_160.0a1', '160.0a1', true)

    expect(binaryDetailSuffix({binary, binaryProvenance: 'managed'})).toBe(
      `, ${binary} (managed)`
    )
  })

  it('adds nothing for a binary with no application.ini', () => {
    const binary = install('chrome', undefined, false)

    expect(
      binaryDetailSuffix({
        binary,
        binaryProvenance: 'pinned',
        binaryPinnedBy: '--chromium-binary'
      })
    ).toBe(`, ${binary} (pinned with --chromium-binary)`)
  })
})
