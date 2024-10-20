import path from 'path'
import {execSync} from 'child_process'
import {extensionFixtures, takeScreenshot} from '../extension-fixtures'

const exampleDir = 'examples/content-react'
const pathToExtension = path.join(__dirname, `dist/chrome`)
const test = extensionFixtures(pathToExtension, true)

test.beforeAll(async () => {
  execSync(`pnpm extension build ${exampleDir}`, {
    cwd: path.join(__dirname, '..')
  })
})

test('should exist an element with the class name extension-root', async ({
  page
}) => {
  await page.goto('https://extension.js.org/')
  const div = page.locator('#extension-root')
  await test.expect(div).toBeVisible()
})

test('should exist an h2 element with specified content', async ({page}) => {
  await page.goto('https://extension.js.org/')
  const h2 = page.locator('#extension-root h2')
  await test.expect(h2).toContainText('This is a content script')
})

test('should exist a default color value', async ({page}) => {
  await page.goto('https://extension.js.org/')
  const h2 = page.locator('#extension-root h2')
  const color = await page.evaluate(
    (locator) => {
      return window.getComputedStyle(locator!).getPropertyValue('color')
    },
    await h2.elementHandle()
  )
  await test.expect(color).toEqual('rgb(255, 255, 255)')
})

test('should load all images successfully', async ({page}) => {
  await page.goto('https://extension.js.org/')
  const images = page.locator('#extension-root img')
  const imageElements = await images.all()

  const results: boolean[] = []

  for (const image of imageElements) {
    const naturalWidth = await page.evaluate(
      (img) => {
        return img ? (img as HTMLImageElement).naturalWidth : 0
      },
      await image.elementHandle()
    )

    const naturalHeight = await page.evaluate(
      (img) => {
        return img ? (img as HTMLImageElement).naturalHeight : 0
      },
      await image.elementHandle()
    )

    const loadedSuccessfully = naturalWidth > 0 && naturalHeight > 0
    results.push(loadedSuccessfully)
  }

  await test.expect(results.every((result) => result)).toBeTruthy()
})
