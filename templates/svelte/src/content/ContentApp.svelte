<script>
  import iconUrl from "../images/icon.png";
  const logo = iconUrl
  const envBrowser = import.meta.env.EXTENSION_PUBLIC_BROWSER
  const isFirefoxLike =
    envBrowser === 'firefox' ||
    envBrowser === 'gecko-based' ||
    /Firefox/i.test(navigator.userAgent)

  function openSidebar() {
    if (isFirefoxLike) return
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({type: 'openSidebar'})
    }
  }
</script>

<button
  type="button"
  class="content_pill"
  aria-label="Open sidebar"
  on:click={openSidebar}
  disabled={isFirefoxLike}
>
  <img class="content_pill_logo" src={logo} alt="" aria-hidden="true" />
  <span class="content_pill_text">
    {isFirefoxLike ? 'Click the browser action to open the sidebar' : 'Open sidebar'}
  </span>
</button>