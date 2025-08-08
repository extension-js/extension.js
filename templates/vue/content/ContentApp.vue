<script lang="ts">
import { defineComponent } from 'vue'
import vueLogo from '../images/logo.svg'

export default defineComponent({
  name: 'ContentApp',
  setup() {
    return {
      vueLogo
    }
  }
})
</script>

<template>
  <div class="content_script">
    <img class="content_logo" :src="vueLogo" alt="Vue Logo" />
    <h1 class="content_title">Vue Extension</h1>
    <p class="content_description">
      This content script runs in the context of web pages.
      <br />
      Learn more about creating cross-browser extensions at
      <a href="https://extension.js.org" target="_blank" rel="noopener noreferrer">
        https://extension.js.org
      </a>
    </p>
  </div>
</template>
