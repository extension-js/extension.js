import { test as base, chromium, type BrowserContext } from '@playwright/test';

export const extensionFixtures = (pathToExtension: string, headless: boolean) => {
    return base.extend<{
        context: BrowserContext;
        extensionId: string;
    }>({
        context: async ({ }, use) => {
            const context = await chromium.launchPersistentContext('', {
                headless: false,
                args: [
                    headless ? `--headless=new` : '',
                    `--disable-extensions-except=${pathToExtension}`,
                    `--load-extension=${pathToExtension}`,
                ].filter(arg => !!arg),
            });
            await use(context);
            await context.close();
        },
        extensionId: async ({ context }, use) => {
            /*
            // for manifest v2:
            let [background] = context.backgroundPages()
            if (!background)
              background = await context.waitForEvent('backgroundpage')
            */

            // for manifest v3:
            let [background] = context.serviceWorkers();
            if (!background)
                background = await context.waitForEvent('serviceworker');

            const extensionId = background.url().split('/')[2];
            await use(extensionId);
        },
    });
}