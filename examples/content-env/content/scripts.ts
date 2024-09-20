import './styles.css'

console.log(
  'hello from content_scripts',
  process.env.EXTENSION_PUBLIC_DESCRIPTION_TEXT
)

// Check if the content has already been added
if (!document.querySelector('.content_script-box')) {
  document.body.innerHTML += `
  <div class="content_script-box">
    <div class="content_script-logo-box">
      <img class="content_script-logo" src="/logo.png" />
    </div>
    <p class="content_script-description">${process.env.EXTENSION_PUBLIC_DESCRIPTION_TEXT}</p>
    <h1 class="content_script-title">
      Change the background-color ⬇
    </h1>
    <input type="color" class="content_script-colorPicker" id="colorPicker">
    <p class="content_script-description">
      Learn more about creating cross-browser extensions at <a
        class="underline hover:no-underline"
        href="https://extension.js.org"
        target="_blank"
      >
      https://extension.js.org
      </a>
    </p>
  </div>
  `
}

const colorPicker = document.getElementById('colorPicker')

// Add the event listener only if it hasn't been added yet
if (colorPicker && !colorPicker.hasAttribute('data-listener')) {
  colorPicker.addEventListener('input', (event) => {
    chrome.runtime
      .sendMessage({
        action: 'changeBackgroundColor',
        // @ts-expect-error
        color: event.target?.value
      })
      .catch(console.error)
  })

  // Mark the element to avoid adding the listener again
  colorPicker.setAttribute('data-listener', 'true')
}
