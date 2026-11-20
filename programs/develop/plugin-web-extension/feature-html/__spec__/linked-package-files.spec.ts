import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  build,
  canLink,
  expectNothingPrivate,
  linkPackages,
  MARKER,
  makeProject,
  manifest,
  outputHolding,
  PAGE,
  pageNotBundledRefs
} from './helpers/private-files-project'

// Whole builds of a fixture project that names a file of a package its
// node_modules folder links to, the way a package manager links a store.

const TIMEOUT = 120_000

// Where each link leads, and whether a file named through it ships.
const LINKS = [
  ['store-pkg', 'the store inside the project', true],
  ['workspace-pkg', 'the store of the workspace above', true],
  ['stray-pkg', 'an unrelated folder', false],
  ['far-pkg', "another project's node_modules", false]
] as const

const page = (body: string) => PAGE.replace('<body>', `<body>${body}`)

// The project with its packages linked, each holding an icon, a page and a
// script. A package the build may not enter carries the marker in each.
function linkedProject(pkg: string, ships: boolean) {
  const {root} = makeProject()
  const mark = ships ? `SHIPPED-${pkg}` : `${MARKER}-${pkg}`
  const folder = path.join(root, 'node_modules', pkg)

  linkPackages(root)
  fs.writeFileSync(path.join(folder, 'icon.png'), `png ${mark}`)
  fs.writeFileSync(path.join(folder, 'page.html'), page(`page ${mark}`))
  fs.writeFileSync(path.join(folder, 'lib.js'), `console.log("${mark}")\n`)

  return {root, mark}
}

function write(root: string, name: string, contents: string) {
  fs.writeFileSync(path.join(root, name), contents)
}

describe.runIf(canLink).each(LINKS)(
  'a file of a package linked to %s (%s)',
  (pkg, _where, ships) => {
    const verdict = ships ? 'ships' : 'is left out and called not bundled'

    it(
      `${verdict} as an icon`,
      async () => {
        const {root, mark} = linkedProject(pkg, ships)

        write(
          root,
          'manifest.json',
          manifest({icons: {16: `node_modules/${pkg}/icon.png`}})
        )

        const result = await build(root)

        expectNothingPrivate(result)
        expect(result.errors).toBe(ships ? 0 : 1)
        expect(outputHolding(root, mark)).toHaveLength(ships ? 1 : 0)
        expect(
          result.printed.includes(
            'is not bundled. Check the icons field in your manifest.json file.'
          )
        ).toBe(!ships)
      },
      TIMEOUT
    )

    it(
      `${verdict} as a page of the manifest`,
      async () => {
        const {root, mark} = linkedProject(pkg, ships)

        write(
          root,
          'manifest.json',
          manifest({
            action: {default_popup: `node_modules/${pkg}/page.html`}
          })
        )

        const result = await build(root)

        expectNothingPrivate(result)
        expect(result.errors).toBe(ships ? 0 : 1)
        expect(outputHolding(root, mark)).toHaveLength(ships ? 1 : 0)
        expect(
          result.printed.includes(
            'is not bundled. Check the action.default_popup field in your manifest.json file.'
          )
        ).toBe(!ships)
      },
      TIMEOUT
    )

    it(
      `${verdict} as an image of a page`,
      async () => {
        const {root, mark} = linkedProject(pkg, ships)
        const ref = `/node_modules/${pkg}/icon.png`

        write(root, 'popup.html', page(`<img src="${ref}">`))

        const result = await build(root)

        expectNothingPrivate(result)
        expect(result.errors).toBe(0)
        expect(outputHolding(root, mark)).toHaveLength(ships ? 1 : 0)
        expect(result.missing).toEqual([])
        expect(pageNotBundledRefs(result.printed)).toEqual(ships ? [] : [ref])
      },
      TIMEOUT
    )

    it(
      `${verdict} as a script of a page`,
      async () => {
        const {root, mark} = linkedProject(pkg, ships)

        write(
          root,
          'popup.html',
          page(`<script src="node_modules/${pkg}/lib.js"></script>`)
        )

        const result = await build(root)

        expectNothingPrivate(result)
        expect(result.errors).toBe(0)
        expect(outputHolding(root, mark)).toHaveLength(ships ? 1 : 0)
        expect(
          result.printed.includes(
            'is not bundled. Check the <script> that names it in this page.'
          )
        ).toBe(!ships)
      },
      TIMEOUT
    )
  }
)
