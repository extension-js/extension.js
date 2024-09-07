import { existsSync } from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { extensionFixtures } from './extension-fixtures';

const exampleDir = 'examples/content-main-world';
const pathToExtension = path.join(__dirname, `../${exampleDir}/dist/chrome`);
const test = extensionFixtures(pathToExtension, true);

test.beforeAll(async () => {
  if (!existsSync(pathToExtension)) {
    execSync(`pnpm extension build ${exampleDir}`, { cwd: path.join(__dirname, '..') });
  }
})

test('should exist an element with the class name content_script-box', async ({ page }) => {
  await page.goto('https://extension.js.org/');
  const div = page.locator('body > div.content_script-box');
  await test.expect(div).toBeVisible();
})

test('should exist an h1 element with specified content', async ({ page }) => {
  await page.goto('https://extension.js.org/');
  const h1 = page.locator('body > div.content_script-box > h1');
  await test.expect(h1).toHaveText('Main World');
})

test('should exist a default color value', async ({ page }) => {
  await page.goto('https://extension.js.org/');
  const h1 = page.locator('body > div.content_script-box > h1');
  const color = await page.evaluate((locator) => {
    return window.getComputedStyle(locator!).getPropertyValue('color');
  }, await h1.elementHandle());
  await test.expect(color).toEqual('rgb(51, 51, 51)');
})
