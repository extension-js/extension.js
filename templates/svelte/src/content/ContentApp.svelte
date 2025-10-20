<script>
  import logo from '../images/logo.png'

  function openSidebar() {
    if (import.meta.env.EXTENSION_PUBLIC_BROWSER === 'firefox') {
      browser.runtime.sendMessage({type: 'openSidebar'})
    } else {
      chrome.runtime.sendMessage({type: 'openSidebar'})
    }
  }
</script>

<button
  type="button"
  class="content_pill"
  aria-label="Open sidebar"
  on:click={openSidebar}
>
  <img class="content_pill_logo" src={logo} alt="" aria-hidden="true" />
  <span class="content_pill_text">Open sidebar</span>
  </button>