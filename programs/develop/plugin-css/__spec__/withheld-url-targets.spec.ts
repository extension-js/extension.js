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
  '.g{background:url(./.npmrc)}',
  '.h{background:url(./.envrc)}',
  '.i{background:url(./.git/config)}',
  '.j{background:url(./.DS_Store)}',
  '.k{background:url(./.env.example)}',
  ''
].join('\n')

const WITHHELD = [
  './.env',
  './.env.local',
  '../../shared/outside.png',
  './linked.png',
  './node_modules/pkg/.env',
  './.npmrc',
  './.envrc',
  './.git/config',
  './.DS_Store'
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
          [`app/${folder}/.npmrc`]: 'MARKER_NPMRC=four\n',
          [`app/${folder}/.envrc`]: 'MARKER_ENVRC=five\n',
          [`app/${folder}/.git/config`]: 'MARKER_GIT_CONFIG\n',
          [`app/${folder}/.DS_Store`]: 'MARKER_DS_STORE\n',
          [`app/${folder}/.env.example`]: 'ALLOWED_ENV_TEMPLATE\n',
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
        // A template that documents the keys of an env file is no secret.
        expect(emitted.filter((entry) => entry.includes('.env'))).toEqual([
          expect.stringMatching(/\.example$/)
        ])

        for (const marker of [
          'MARKER_ENV',
          'MARKER_LOCAL',
          'MARKER_PKG_ENV',
          'MARKER_SHARED_IMAGE',
          'MARKER_LINKED_IMAGE',
          'MARKER_NPMRC',
          'MARKER_ENVRC',
          'MARKER_GIT_CONFIG',
          'MARKER_DS_STORE'
        ]) {
          expect(shipped).not.toContain(marker)
          expect(shipped).not.toContain(inlined(marker))
        }

        // The package image and the env template ship, inlined or as files.
        for (const allowed of ['ALLOWED_PKG_IMAGE', 'ALLOWED_ENV_TEMPLATE']) {
          expect(
            shipped.includes(allowed) || shipped.includes(inlined(allowed))
          ).toBe(true)
        }

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

    // A sibling package of a workspace is the project's to name, a private
    // name in it never.
    it('a content script sheet ships a file of a sibling package in a workspace', async () => {
      const root = makeProject({
        'package.json': JSON.stringify({private: true, workspaces: ['*']}),
        'app/package.json': JSON.stringify({
          private: true,
          name: 'sibling',
          version: '0.0.0'
        }),
        'app/manifest.json': JSON.stringify({
          manifest_version: 3,
          name: 'sibling',
          version: '1.0.0',
          content_scripts: [
            {matches: ['<all_urls>'], js: ['content/scripts.js']}
          ]
        }),
        'app/content/scripts.js':
          "import href from './styles.css'\ndocument.head.append(Object.assign(document.createElement('link'), {rel: 'stylesheet', href}))\n",
        'app/content/styles.css':
          '.a{background:url(../../shared/img.png)}\n.b{background:url(../../shared/.env)}\n',
        'shared/img.png': 'SIBLING_IMAGE\n',
        'shared/.env': 'MARKER_SIBLING_ENV=seven\n'
      })
      const app = path.join(root, 'app')
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
      const shipped = (fs.readdirSync(dist, {recursive: true}) as string[])
        .filter((entry) => fs.statSync(path.join(dist, entry)).isFile())
        .map((entry) => fs.readFileSync(path.join(dist, entry), 'utf8'))
        .join('\n')

      expect(summary.errors_count).toBe(0)
      expect(
        shipped.includes('SIBLING_IMAGE') ||
          shipped.includes(inlined('SIBLING_IMAGE'))
      ).toBe(true)

      expect(shipped).not.toContain('url(../../shared/img.png)')
      expect(shipped).not.toContain('MARKER_SIBLING_ENV')
      expect(shipped).not.toContain(inlined('MARKER_SIBLING_ENV'))
      expect(
        (summary.warnings ?? []).map(
          (warning) => /A url\((\S+)\) reference points/.exec(warning)?.[1]
        )
      ).toEqual(['../../shared/.env'])
    }, 120_000)
  }
)
