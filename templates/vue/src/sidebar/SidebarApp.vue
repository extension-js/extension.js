<template>
  <div class="sidebar_app">
    <img class="sidebar_logo" :src="vueLogo" alt="The Vue logo" />
    <h1 class="sidebar_title">Sidebar Panel</h1>
    <p class="sidebar_description">
      Learn more about creating cross-browser extensions at
      <a href="https://extension.js.org" target="_blank" rel="noopener noreferrer">
        https://extension.js.org
      </a>
      .
    </p>
  </div>
</template>

<script setup lang="ts">
import vueLogo from '../images/logo.svg'
</script>
