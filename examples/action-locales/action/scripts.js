if (
  import.meta.env.EXTENSION_PUBLIC_BROWSER === 'firefox' ||
  import.meta.env.EXTENSION_PUBLIC_BROWSER === 'firefox-based'
) {
  document.getElementById('title').textContent = chrome.i18n.getMessage('title')
  document.getElementById('learnMore').textContent =
    chrome.i18n.getMessage('learnMore')
} else {
  document.getElementById('title').textContent = chrome.i18n.getMessage('title')
  document.getElementById('learnMore').textContent =
    chrome.i18n.getMessage('learnMore')
}
