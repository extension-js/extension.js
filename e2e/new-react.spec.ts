import { existsSync } from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { extensionFixtures } from './extension-fixtures';

const exampleDir = 'examples/new-react';
const pathToExtension = path.join(__dirname, `../${exampleDir}/dist/chrome`);
const test = extensionFixtures(pathToExtension, true);

test.beforeAll(async () => {
  execSync(`pnpm extension build ${exampleDir}`, { cwd: path.join(__dirname, '..') });
})

test('should exist an element with the class name content_script-box', async ({ page }) => {
  await page.goto('chrome://newtab/');
  const h1 = page.locator('h1');
  await test.expect(h1).toHaveText('Welcome to your React Extension.');
})

test('should exist a default color value', async ({ page }) => {
  await page.goto('chrome://newtab/');
  const h1 = page.locator('h1');
  const color = await page.evaluate((locator) => {
    return window.getComputedStyle(locator!).getPropertyValue('color');
  }, await h1.elementHandle());
  await test.expect(color).toEqual('rgb(74, 74, 74)');
})
