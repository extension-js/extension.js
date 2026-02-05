<script>
import iconUrl from "../images/icon.png"
import { defineComponent } from 'vue'

const vueLogo = iconUrl

export default defineComponent({
  name: 'ContentApp',
  setup() {
    const envBrowser = import.meta.env.EXTENSION_PUBLIC_BROWSER
    const isFirefoxLike =
      envBrowser === 'firefox' ||
      envBrowser === 'gecko-based' ||
      /Firefox/i.test(navigator.userAgent)

    const openSidebar = () => {
      if (isFirefoxLike) return
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        chrome.runtime.sendMessage({ type: 'openSidebar' })
      }
    }
    return { vueLogo, openSidebar, isFirefoxLike }
  }
})
</script>

<template>
  <button
    type="button"
    class="content_pill"
    aria-label="Open sidebar"
    @click="openSidebar"
    :disabled="isFirefoxLike"
  >
    <img class="content_pill_logo" :src="vueLogo" alt="" aria-hidden="true" />
    <span class="content_pill_text">
      {{ isFirefoxLike ? 'Click the browser action to open the sidebar' : 'Open sidebar' }}
    </span>
  </button>
</template>
