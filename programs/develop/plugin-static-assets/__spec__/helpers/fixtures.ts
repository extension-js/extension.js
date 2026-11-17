import type {FixtureFiles} from './compile-harness'

// A 1x1 PNG, 70 bytes.
export const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)

// A module exporting `answer`, which returns 42.
export const ANSWER_WASM = Buffer.from(
  'AGFzbQEAAAABBQFgAAF/AwIBAAcKAQZhbnN3ZXIAAAoGAQQAQSoL',
  'base64'
)

// Exactly `size` bytes that start like a PNG, so mime detection is stable.
export function pngOfSize(size: number): Buffer {
  return Buffer.concat([PIXEL_PNG, Buffer.alloc(size - PIXEL_PNG.length, 0x41)])
}

export const SMALL_SVG = '<svg xmlns="http://www.w3.org/2000/svg"/>\n'
export const NOTES_TXT = 'hello text\n'

// One import per kind of asset the plugins handle, each value put on `out`.
export function assetsFixture(
  extraIndexLines: string[] = [],
  extraKeys: string[] = []
): FixtureFiles {
  return {
    'small.png': pngOfSize(2048),
    'large.png': pngOfSize(2049),
    'icon.svg': SMALL_SVG,
    'font.woff2': Buffer.alloc(3000, 0x42),
    'notes.txt': NOTES_TXT,
    'answer.wasm': ANSWER_WASM,
    'index.js': [
      "import small from './small.png'",
      "import large from './large.png'",
      "import icon from './icon.svg'",
      "import font from './font.woff2'",
      "import notes from './notes.txt'",
      "import smallUrl from './small.png?url'",
      "import notesRaw from './notes.txt?raw'",
      "const viaNewUrl = new URL('./large.png', import.meta.url).href",
      "const wasmAnswer = import('./answer.wasm').then((m) => m.answer())",
      ...extraIndexLines,
      `self.out = {${['small', 'large', 'icon', 'font', 'notes', 'smallUrl', 'notesRaw', 'viaNewUrl', 'wasmAnswer', ...extraKeys].join(', ')}}`,
      ''
    ].join('\n')
  }
}
