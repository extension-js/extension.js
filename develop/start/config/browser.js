module.exports = (extensionPath, browserFlags, browserOptions) => {
   return {
    ignoreDefaultFlags: true,
     ...browserOptions,
     // Flags to pass to Chrome
     // https://github.com/GoogleChrome/chrome-launcher/blob/master/docs/chrome-flags-for-tools.md
     // Flags set by default:
     // https://github.com/GoogleChrome/chrome-launcher/blob/master/src/flags.ts
    chromeFlags: [`--load-extension=${extensionPath}`, ...browserFlags], // Array<string>
  }
}
