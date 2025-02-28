This is an example for this plugin use with React HMR.

1. Run `yarn` to install dependencies
2. Run `yarn start` (or `start-rspack`)
3. Open Chrome, install the demo extension from the dist/ folder.
4. Open http://example.com/, You can see a React UI.
5. Change ./src/shared/message.tsx and see HMR happens.
6. Open the options page of this extension (right click on the extension to open the menu).
7. The same UI rendered in the chrome-extension:// protocol also gets HMR.
