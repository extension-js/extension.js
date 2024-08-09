<script>
export default {
  data() {
    return {
      message: 'Welcome to your Vue Extension.'
    }
  }
}
</script>
<template>
  <header>
    <h1>
      <img
        class="vue"
        src="../images/vue.svg"
        alt="The Vue logo"
        width="120px"
      />
      <br />
      {{message}}
    </h1>
    <p>
      Learn more about creating browser extensions at 
      <a href="https://extension.js.org" target="_blank">
        https://extension.js.org
      </a>
      .
    </p>
  </header>
</template>
