// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {describe, expect, it} from 'vitest'
import {StampWebkitUtf8Bom, UTF8_BOM} from '../steps/stamp-webkit-utf8-bom'

const BACKGROUND = 'console.info("…", "王伟");\n'

function makeCompilation(assets: Record<string, string>) {
  const store: Record<string, string> = {...assets}
  const compilation: any = {
    getAssets: () =>
      Object.keys(store).map((name) => ({
        name,
        source: {source: () => Buffer.from(store[name], 'utf8')}
      })),
    updateAsset: (name: string, source: {source(): string | Buffer}) => {
      store[name] = source.source().toString()
    },
    hooks: {
      processAssets: {tap: (_opts: any, fn: any) => fn()}
    }
  }
  const compiler: any = {
    hooks: {
      thisCompilation: {tap: (_n: string, fn: any) => fn(compilation)}
    }
  }

  return {compiler, store}
}

function decodedAsSafariWould(text: string): string {
  const bytes = Buffer.from(text, 'utf8')

  return bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
    ? bytes.subarray(3).toString('utf8')
    : new TextDecoder('windows-1252').decode(bytes)
}

describe('StampWebkitUtf8Bom', () => {
  it('puts a UTF-8 byte order mark first on every Safari script so non-ASCII text survives the background page', () => {
    const {compiler, store} = makeCompilation({
      'background/service_worker.js': BACKGROUND,
      'hot/169.abc.js': 'export const badge = "…"\n',
      'content_scripts/content-0.js': 'document.title = "王伟"\n',
      'manifest.json': '{"name":"…"}',
      'styles/main.css': '.a::after{content:"…"}'
    })
    new StampWebkitUtf8Bom({browser: 'safari'}).apply(compiler)

    for (const name of [
      'background/service_worker.js',
      'hot/169.abc.js',
      'content_scripts/content-0.js'
    ]) {
      expect(store[name].charCodeAt(0)).toBe(0xfeff)
      expect(Buffer.from(store[name], 'utf8').subarray(0, 3)).toEqual(
        Buffer.from([0xef, 0xbb, 0xbf])
      )
    }

    expect(store['background/service_worker.js']).toBe(
      `${UTF8_BOM}${BACKGROUND}`
    )

    expect(decodedAsSafariWould(store['background/service_worker.js'])).toBe(
      BACKGROUND
    )

    expect(decodedAsSafariWould(store['hot/169.abc.js'])).toContain('…')
    expect(
      decodedAsSafariWould(store['content_scripts/content-0.js'])
    ).toContain('王伟')

    expect(store['manifest.json']).toBe('{"name":"…"}')
    expect(store['styles/main.css']).toBe('.a::after{content:"…"}')
  })

  it('reads as mojibake without the mark, the way Safari read the bundle', () => {
    expect(decodedAsSafariWould(BACKGROUND)).toContain('â€¦')
    expect(decodedAsSafariWould(BACKGROUND)).not.toContain('…')
    expect(decodedAsSafariWould(BACKGROUND)).not.toContain('王伟')
  })

  it('stamps a script once across compiles', () => {
    const {compiler, store} = makeCompilation({
      'background/service_worker.js': `${UTF8_BOM}${BACKGROUND}`
    })
    new StampWebkitUtf8Bom({browser: 'safari'}).apply(compiler)

    expect(store['background/service_worker.js']).toBe(
      `${UTF8_BOM}${BACKGROUND}`
    )
  })

  it('leaves every other browser alone', () => {
    for (const browser of ['chrome', 'edge', 'firefox', 'chromium-based']) {
      const {compiler, store} = makeCompilation({
        'background/service_worker.js': BACKGROUND
      })
      new StampWebkitUtf8Bom({browser}).apply(compiler)

      expect(store['background/service_worker.js']).toBe(BACKGROUND)
    }
  })
})
