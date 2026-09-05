import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {
  manifestJsonOutputTarget,
  manifestPageOutputTarget
} from '../normalize-manifest-path'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, {recursive: true, force: true})
  }
})

function createProject(files: string[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-page-target-'))
  tempDirs.push(dir)
  for (const file of files) {
    const abs = path.join(dir, file)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, '<html></html>')
  }
  return path.join(dir, 'manifest.json')
}

describe('manifestPageOutputTarget', () => {
  it('maps a relative ref to the compiled surface', () => {
    const manifestPath = createProject(['page/options.html'])
    expect(
      manifestPageOutputTarget(
        'page/options.html',
        'options/index.html',
        manifestPath
      )
    ).toBe('options/index.html')
  })

  it('maps a root-absolute ref that exists at the project root to the compiled surface', () => {
    const manifestPath = createProject(['page/options.html'])
    expect(
      manifestPageOutputTarget(
        '/page/options.html',
        'options/index.html',
        manifestPath
      )
    ).toBe('options/index.html')
  })

  it('covers the .htm spelling of the class', () => {
    const manifestPath = createProject(['pages/config.htm'])
    expect(
      manifestPageOutputTarget(
        '/pages/config.htm',
        'options/index.html',
        manifestPath
      )
    ).toBe('options/index.html')
  })

  it('keeps public/ precedence for a root-absolute ref public owns', () => {
    const manifestPath = createProject(['public/page/options.html'])
    expect(
      manifestPageOutputTarget(
        '/page/options.html',
        'options/index.html',
        manifestPath
      )
    ).toBe('page/options.html')
  })

  it('strips the public/ prefix from explicitly public refs', () => {
    const manifestPath = createProject(['public/page/options.html'])
    expect(
      manifestPageOutputTarget(
        '/public/page/options.html',
        'options/index.html',
        manifestPath
      )
    ).toBe('page/options.html')
    expect(
      manifestPageOutputTarget(
        './public/page/options.html',
        'options/index.html',
        manifestPath
      )
    ).toBe('page/options.html')
  })

  it('keeps the normalized raw path when the ref exists nowhere', () => {
    const manifestPath = createProject([])
    expect(
      manifestPageOutputTarget(
        '/page/missing.html',
        'options/index.html',
        manifestPath
      )
    ).toBe('page/missing.html')
  })
})

describe('manifestJsonOutputTarget', () => {
  const slot = 'declarative_net_request/block.json'

  it('keeps a plain ref beside the manifest at the compiled slot', () => {
    const manifestPath = createProject(['rules.json', 'public/rules.json'])
    expect(manifestJsonOutputTarget('rules.json', slot, manifestPath)).toBe(
      slot
    )
    expect(manifestJsonOutputTarget('./rules.json', slot, manifestPath)).toBe(
      slot
    )
  })

  it('names the copied file for a plain ref only public/ owns', () => {
    const manifestPath = createProject(['public/rules.json'])
    expect(manifestJsonOutputTarget('rules.json', slot, manifestPath)).toBe(
      'rules.json'
    )
    expect(manifestJsonOutputTarget('./rules.json', slot, manifestPath)).toBe(
      'rules.json'
    )
  })

  it('reaches the root public/ through projectPath for a src/ manifest', () => {
    const manifestPath = createProject(['public/rules.json'])
    const root = path.dirname(manifestPath)
    fs.mkdirSync(path.join(root, 'src'), {recursive: true})
    const srcManifest = path.join(root, 'src', 'manifest.json')
    expect(manifestJsonOutputTarget('rules.json', slot, srcManifest)).toBe(slot)
    expect(
      manifestJsonOutputTarget('rules.json', slot, srcManifest, root)
    ).toBe('rules.json')
  })

  it('keeps the slot for a file under a shadowed next-to-manifest public/', () => {
    // Both folders exist, so only the root one ships. feature-json emits the
    // src/public/ file at its slot and the manifest must name that slot.
    const manifestPath = createProject([
      'public/other.json',
      'src/public/rules.json'
    ])
    const root = path.dirname(manifestPath)
    const srcManifest = path.join(root, 'src', 'manifest.json')
    expect(
      manifestJsonOutputTarget('rules.json', slot, srcManifest, root)
    ).toBe(slot)
  })

  it('keeps the slot for a missing plain ref and for refs that leave the root', () => {
    const manifestPath = createProject(['public/rules.json'])
    expect(manifestJsonOutputTarget('missing.json', slot, manifestPath)).toBe(
      slot
    )
    expect(
      manifestJsonOutputTarget('../public/rules.json', slot, manifestPath)
    ).toBe(slot)
    expect(manifestJsonOutputTarget('rules.json', slot)).toBe(slot)
  })

  it('leaves the public/ prefix and leading-slash spellings to the pages rule', () => {
    const manifestPath = createProject(['public/rules.json'])
    expect(
      manifestJsonOutputTarget('public/rules.json', slot, manifestPath)
    ).toBe('rules.json')
    expect(manifestJsonOutputTarget('/rules.json', slot, manifestPath)).toBe(
      'rules.json'
    )
  })
})
