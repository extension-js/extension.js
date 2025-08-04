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
    <img class="content_logo" :src="vueLogo" alt="Extension Logo" />
    <h1 class="content_title">Content Script<br />Vue Extension</h1>
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

<style>
.content_script {
  color: #c9c9c9;
  background-color: #0a0c10;
  position: fixed;
  right: 0;
  bottom: 0;
  z-index: 9;
  width: 280px;
  margin: 1rem;
  padding: 2rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5em;
  border-radius: 6px;
  z-index: 9999;
}

.content_logo {
  width: 72px;
  margin-bottom: 0;
}

.content_title {
  font-size: 1.5em;
  line-height: 1;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
    'Helvetica Neue', Arial, 'Noto Sans', sans-serif;
  font-weight: 700;
  margin: 0;
}

.content_description {
  font-size: small;
  margin: 0;
}

.content_description a {
  text-decoration: none;
  border-bottom: 2px solid #c9c9c9;
  color: #e5e7eb;
  margin: 0;
}
</style>
