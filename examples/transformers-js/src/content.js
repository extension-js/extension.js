// content.js - the content scripts which is run in the context of web pages, and has access
// to the DOM and other web APIs.
//
// Example usage:
//
// import { ACTION_NAME } from "./constants.js";
// const message = {
//     action: ACTION_NAME,
//     text: 'text to classify',
// }
// const response = await chrome.runtime.sendMessage(message);
// console.log('received user data', response)
