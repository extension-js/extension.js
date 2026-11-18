import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {cssProjects} from './helpers/css-project'

const makeProject = cssProjects()

const SHEET = [
  '.a{background:url(./.env)}',
  '.b{background:url("./.env.local")}',
  '.c{background:url(../../shared/outside.png)}',
  '.d{background:url(./linked.png)}',
  '.e{background:url(./node_modules/pkg/.env)}',
  '.f{background:url(./node_modules/pkg/img.png)}',
  ''
].join('\n')

const WITHHELD = [
  './.env',
  './.env.local',
  '../../shared/outside.png',
  './linked.png',
  './node_modules/pkg/.env'
]

// What a file's text reads as once a bundler inlines it in a data: URL.
const inlined = (text: string) =>
  Buffer.from(text).toString('base64').slice(0, 16)

// A url() names a file, and the build ships no file under a private name or
// from outside the project, whichever sheet names it.
describe.skipIf(process.platform === 'win32')(
  'a url() that names a file the build withholds, built',
  () => {
    it.each([
      ['a content script sheet', 'content'],
      ['a page sheet', 'page']
    ])(
      '%s keeps the address as written and ships nothing for it',
      async (_label, folder) => {
        const root = makeProject({
          'app/package.json': JSON.stringify({
            private: true,
            name: 'withheld',
            version: '0.0.0'
          }),
          'app/manifest.json': JSON.stringify({
            manifest_version: 3,
            name: 'withheld',
            version: '1.0.0',
            action: {default_popup: 'page/popup.html'},
            content_scripts: [
              {matches: ['<all_urls>'], js: ['content/scripts.js']}
            ]
          }),
          'app/content/scripts.js':
            folder === 'content'
              ? "import href from './styles.css'\ndocument.head.append(Object.assign(document.createElement('link'), {rel: 'stylesheet', href}))\n"
              : 'document.title = "x"\n',
          'app/page/popup.html': `<!doctype html>${folder === 'page' ? '<link rel="stylesheet" href="./styles.css">' : ''}<p>x</p>\n`,
          [`app/${folder}/styles.css`]: SHEET,
          [`app/${folder}/.env`]: 'MARKER_ENV=one\n',
          [`app/${folder}/.env.local`]: 'MARKER_LOCAL=two\n',
          [`app/${folder}/node_modules/pkg/.env`]: 'MARKER_PKG_ENV=three\n',
          [`app/${folder}/node_modules/pkg/img.png`]: 'ALLOWED_PKG_IMAGE\n',
          'shared/outside.png': 'MARKER_SHARED_IMAGE\n',
          'linked.png': 'MARKER_LINKED_IMAGE\n'
        })
        const app = path.join(root, 'app')

        fs.symlinkSync(
          path.join(root, 'linked.png'),
          path.join(app, folder, 'linked.png')
        )

        const {extensionBuild} = await import('../../command-build')
        const previous = process.env.VITEST

        process.env.VITEST = 'true'

        let summary: {errors_count: number; warnings?: string[]}

        try {
          summary = (await extensionBuild(app, {
            browser: 'chrome',
            silent: true,
            install: false,
            mode: 'production',
            exitOnError: false
          } as never)) as typeof summary
        } finally {
          if (previous === undefined) delete process.env.VITEST
          else process.env.VITEST = previous
        }

        const dist = path.join(app, 'dist', 'chrome')
        const emitted = (
          fs.readdirSync(dist, {recursive: true}) as string[]
        ).filter((entry) => fs.statSync(path.join(dist, entry)).isFile())
        const shipped = emitted
          .map((entry) => fs.readFileSync(path.join(dist, entry), 'utf8'))
          .join('\n')

        expect(summary.errors_count).toBe(0)
        expect(emitted.filter((entry) => entry.includes('.env'))).toEqual([])

        for (const marker of [
          'MARKER_ENV',
          'MARKER_LOCAL',
          'MARKER_PKG_ENV',
          'MARKER_SHARED_IMAGE',
          'MARKER_LINKED_IMAGE'
        ]) {
          expect(shipped).not.toContain(marker)
          expect(shipped).not.toContain(inlined(marker))
        }

        // The package image ships, inlined or as a file of its own.
        expect(
          shipped.includes('ALLOWED_PKG_IMAGE') ||
            shipped.includes(inlined('ALLOWED_PKG_IMAGE'))
        ).toBe(true)

        for (const request of WITHHELD) {
          expect(shipped).toMatch(
            new RegExp(
              `url\\(\\\\?["']?${request.replace(/[.]/g, '\\.')}\\\\?["']?\\)`
            )
          )
        }

        expect(
          (summary.warnings ?? [])
            .map(
              (warning) => /A url\((\S+)\) reference points/.exec(warning)?.[1]
            )
            .sort()
        ).toEqual([...WITHHELD].sort())
      },
      120_000
    )
  }
)
