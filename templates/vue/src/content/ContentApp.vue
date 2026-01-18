<script>
import { defineComponent } from 'vue'
import vueLogo from '../images/logo.svg'

export default defineComponent({
  name: 'ContentApp',
  setup() {
    const openSidebar = () => {
        if (import.meta.env.EXTENSION_PUBLIC_BROWSER === 'firefox') {
          browser.runtime.sendMessage({ type: 'openSidebar' })
      } else {
        chrome.runtime.sendMessage({ type: 'openSidebar' })
      }
    }
    return { vueLogo, openSidebar }
  }
})
</script>
<template>
  <button
    type="button"
    class="content_pill"
    aria-label="Open sidebar"
    @click="openSidebar"
  >
    <img class="content_pill_logo" :src="vueLogo" alt="" aria-hidden="true" />
    <span class="content_pill_text">Open sidebar</span>
  </button>
</template>
