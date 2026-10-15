(() => {
  const storageKey = "quickKeysMarkdown";
  const editor = document.getElementById("quick-keys");
  const status = document.getElementById("status");

  async function loadDefaults() {
    const response = await fetch(chrome.runtime.getURL("quick_keys.md"));
    if (!response.ok) throw new Error(`quick_keys.md returned ${response.status}`);
    return response.text();
  }

  async function initialize() {
    try {
      const saved = await chrome.storage.local.get(storageKey);
      editor.value = saved[storageKey] ?? await loadDefaults();
    } catch (error) {
      console.error("Street View Quick Keys: could not load the prompt editor.", error);
      status.textContent = "Could not load prompts. Check the extension and try again.";
    }
  }

  document.getElementById("save").addEventListener("click", async () => {
    const hasEntry = editor.value.split(/\r?\n/).some((line) => /^\s*[^:]+:\s*\S/.test(line));
    if (!hasEntry) {
      status.textContent = "Add at least one valid label: prompt entry before saving.";
      return;
    }

    try {
      await chrome.storage.local.set({ [storageKey]: editor.value });
      status.textContent = "Saved. Open Street View menus are updated.";
    } catch (error) {
      console.error("Street View Quick Keys: could not save customized prompts.", error);
      status.textContent = "Could not save changes. Check the extension and try again.";
    }
  });

  document.getElementById("reset").addEventListener("click", async () => {
    try {
      const defaults = await loadDefaults();
      await chrome.storage.local.remove(storageKey);
      editor.value = defaults;
      status.textContent = "Restored defaults from quick_keys.md.";
    } catch (error) {
      console.error("Street View Quick Keys: could not restore default prompts.", error);
      status.textContent = "Could not restore defaults. Check the extension and try again.";
    }
  });

  initialize();
})();
