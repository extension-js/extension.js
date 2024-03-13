document.body.innerHTML += `
<div class="box">
<h1 class="title">Change background ⬇</h1>
<input type="color" class="colorPicker" id="colorPicker">
</div>
`

document.getElementById('colorPicker').addEventListener('input', (event) => {
  document.body.style.backgroundColor = event.target.value
})
