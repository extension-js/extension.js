/** @type {import('extension').FileConfig} */
// Extension.js uses a fresh profile on every run.
// Prefer that default? Remove the profile config below.
const profile = (name) => `./dist/extension-profile-${name}`
const companionExtensions = ['acndjpgkpaclldomagafnognkcgjignd']

export default {
  browser: {
    chrome: {profile: profile('chrome'), extensions: companionExtensions},
    chromium: {profile: profile('chromium'), extensions: companionExtensions},
    edge: {profile: profile('edge')},
    firefox: {profile: profile('firefox')},
    'chromium-based': {profile: profile('chromium-based')},
    'gecko-based': {profile: profile('gecko-based')}
  }
}
