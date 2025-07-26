# extension.js Monorepo Reproduction Repo

## Case 1: Types

https://github.com/extension-js/extension.js/issues/276

Comment out the contents of the file `clients/browser-extension/app/browser.d.ts` and your IDE will report `Cannot find name 'browser'.ts(2304)` in `clients/browser-extension/background/index.ts`.

## Case 2: Monorepo-specific polyfill loading path issue

https://github.com/extension-js/extension.js/issues/266

Run `yarn dev-browser` from root to see:

```bash
@extension/browser:dev: cache bypass, force executing 18ac9aefb03e25df
@extension/browser:dev: ►►► Installing project dependencies...
@extension/browser:dev: ►►► Using extension.config.js. This is very experimental.
@extension/browser:dev: ✖︎✖︎✖︎ My Extension compiled with errors in 85 ms.
@extension/browser:dev: ERROR in ./background/index.ts 28:0-7
@extension/browser:dev:   × Module not found: Can't resolve '/Users/<somepath>/extension-js-monorepo/node_modules/extension-develop/node_modules/webextension-polyfill/dist/browser-polyfill.js' in '/Users/<somepath>/extension-js-monorepo/clients/browser-extension/background'
@extension/browser:dev:    ╭─[1:0]
@extension/browser:dev:  1 │ chrome.runtime.onMessageExternal.addListener(async (request, _sender, sendResponse)=>{
@extension/browser:dev:    · ▲
@extension/browser:dev:  2 │     const managementInfo = await new Promise((resolve)=>{
@extension/browser:dev:  3 │         chrome.management.getSelf(resolve);
@extension/browser:dev:    ╰────
@extension/browser:dev:
```
