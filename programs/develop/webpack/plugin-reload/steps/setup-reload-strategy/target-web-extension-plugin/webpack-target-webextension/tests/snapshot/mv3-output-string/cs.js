;(() => {
	const getURL = typeof browser === "object" ? browser.runtime.getURL : chrome.runtime.getURL;
	["runtime.js","test_txt-util_js.js","content.js"].forEach(file => import(getURL(file)));
})();
null;