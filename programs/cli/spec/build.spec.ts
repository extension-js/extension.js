//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝

import path from 'path'
import fs from 'fs'
import {exec} from 'child_process'
import {promisify} from 'util'
import {
  ALL_TEMPLATES,
  BROWSERS,
  DEFAULT_TEMPLATE,
  CUSTOM_TEMPLATES
} from './constants'

const execAsync = promisify(exec)

async function extensionProgram(command: string = '') {
  const cliCommand = `ts-node ${path.join(
    __dirname,
    '..',
    'dist',
    'cli.js'
  )} ${command}`
  return await execAsync(cliCommand)
}

async function removeDir(dirPath: string) {
  if (fs.existsSync(dirPath)) {
    await fs.promises.rm(dirPath, {recursive: true})
  }
}

describe('extension build', () => {
  beforeEach(async () => {
    ALL_TEMPLATES.map(async (template) => {
      const templatePath = path.join(__dirname, 'fixtures', template, 'dist')

      await removeDir(templatePath)
      return true
    })
  })

  describe('running built-in templates', () => {
    it.each([DEFAULT_TEMPLATE])(
      `builds the "%s" extension template`,
      async (template) => {
        const templatePath = path.join(__dirname, 'fixtures', template)

        await extensionProgram(`build ${templatePath}`)

        // For all: Expect template folder to exist
        expect(fs.existsSync(templatePath)).toBeTruthy()
      },
      50000
    )

    it.each([CUSTOM_TEMPLATES])(
      `builds an extension created via "%s" template`,
      async (template) => {
        const templatePath = path.join(__dirname, 'fixtures', template)
        const templateDistPath = path.join(
          __dirname,
          'fixtures',
          template,
          'dist',
          BROWSERS[0]
        )

        await extensionProgram(`build ${templatePath}`)

        // Expect template folder to exist
        expect(fs.existsSync(templateDistPath)).toBeTruthy()

        // Expect manifest file to exist
        expect(
          fs.existsSync(path.join(templateDistPath, 'manifest.json'))
        ).toBeTruthy()

        // Expect context ui files to exist
        expect(
          fs.existsSync(
            path.join(templateDistPath, 'side_panel', 'default_path.css')
          )
        ).toBeTruthy()
        expect(
          fs.existsSync(
            path.join(templateDistPath, 'side_panel', 'default_path.html')
          )
        ).toBeTruthy()
        expect(
          fs.existsSync(
            path.join(templateDistPath, 'side_panel', 'default_path.css')
          )
        ).toBeTruthy()

        expect(
          fs.existsSync(path.join(templateDistPath, 'assets', 'chatgpt.png'))
        ).toBeTruthy()
        expect(
          fs.existsSync(path.join(templateDistPath, 'assets', 'extension.png'))
        ).toBeTruthy()
      },
      80000
    )
  })

  describe('using the --browser flag', () => {
    it.each([CUSTOM_TEMPLATES])(
      `builds the "%s" extension template across all browsers`,
      async (template) => {
        const templatePath = path.join(__dirname, 'fixtures', template)
        // Firefox is skippeed because it can't handle service workers.
        const [chrome, edge /*, firefox */] = BROWSERS
        const chromeDistPath = path.join(
          __dirname,
          'fixtures',
          template,
          'dist',
          chrome
        )
        const edgeDistPath = path.join(
          __dirname,
          'fixtures',
          template,
          'dist',
          edge
        )

        await extensionProgram(`build ${templatePath} --browser=chrome,edge`)

        expect(fs.existsSync(chromeDistPath)).toBeTruthy()
        expect(fs.existsSync(edgeDistPath)).toBeTruthy()
      },
      50000
    )
  })

  // describe('using the --polyfill flag', () => {
  //   it.each([CUSTOM_TEMPLATES])(
  //     `builds an extension created via "%s" template with the polyfill code`,
  //     async (template) => {
  //       const templatePath = path.join(__dirname, 'fixtures', template)

  //       await extensionProgram(`build ${templatePath} --polyfill`)

  //       // TODO
  //     },
  //     50000
  //   )
  // })

  describe('using the --zip flag', () => {
    it.each([DEFAULT_TEMPLATE])(
      `builds and zips the distribution files of an extension created via "%s" template`,
      async (template) => {
        const templatePath = path.join(__dirname, 'fixtures', template)
        const templateDistPath = path.join(
          __dirname,
          'fixtures',
          template,
          'dist',
          BROWSERS[0],
          `${template}-1.0.zip`
        )

        await extensionProgram(`build ${templatePath} --zip`)

        // Expect template folder to exist
        expect(fs.existsSync(templateDistPath)).toBeTruthy()
      },
      50000
    )

    it.each([DEFAULT_TEMPLATE])(
      `builds and zips the source files of an extension created via "%s" template`,
      async (template) => {
        const templatePath = path.join(__dirname, 'fixtures', template)
        const templateDistPath = path.join(
          __dirname,
          'fixtures',
          template,
          'dist',
          BROWSERS[0],
          `${template}-1.0-source.zip`
        )

        await extensionProgram(`build ${templatePath} --zip-source`)

        // Expect template folder to exist
        expect(fs.existsSync(templateDistPath)).toBeTruthy()
      },
      50000
    )

    it.each([DEFAULT_TEMPLATE])(
      `builds and zips the source files of an extension created via "%s" template with a custom output name using the --zip-filename flag`,
      async (template) => {
        const templatePath = path.join(__dirname, 'fixtures', template)
        const templateDistPath = path.join(
          __dirname,
          'fixtures',
          template,
          'dist',
          BROWSERS[0],
          `${template}-nice.zip`
        )

        await extensionProgram(
          `build ${templatePath} --zip --zip-filename ${template}-nice`
        )

        // Expect template folder to exist
        expect(fs.existsSync(templateDistPath)).toBeTruthy()
      },
      50000
    )
  })
})
