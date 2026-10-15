(() => {
  const hostId = "street-view-quick-keys";
  const keysUrl = chrome.runtime.getURL("quick_keys.md");
  const customizeUrl = chrome.runtime.getURL("customize.html");
  const positionKey = "street-view-quick-keys-position";
  const quickKeysStorageKey = "quickKeysMarkdown";
  let host;
  let observer;
  let menu;
  let status;

  function parseQuickKeys(markdown) {
    return markdown.split(/\r?\n/).flatMap((line) => {
      const match = line.match(/^\s*([^:]+):\s*("(?:[^"\\]|\\.)*"|'[^']*'|.*)\s*$/);
      if (!match) return [];

      const label = match[1].trim();
      let prompt = match[2].trim();
      if (
        (prompt.startsWith('"') && prompt.endsWith('"')) ||
        (prompt.startsWith("'") && prompt.endsWith("'"))
      ) {
        prompt = prompt.slice(1, -1);
      }
      return label && prompt ? [{ label, prompt }] : [];
    });
  }

  function isStreetView() {
    const streetViewUrl = /\/@[^/]+,\d+(?:\.\d+)?a,\d+y/i.test(location.href);
    if (streetViewUrl) return true;

    return [...document.querySelectorAll(
      "button[aria-label*='Street View' i],[role='button'][aria-label*='Street View' i]",
    )].some((button) => /exit street view|close street view/i.test(button.getAttribute("aria-label")));
  }

  async function copyPrompt(prompt, button, status) {
    try {
      await navigator.clipboard.writeText(prompt);
    } catch (error) {
      const textarea = document.createElement("textarea");
      textarea.value = prompt;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      if (!copied) {
        console.error("Street View Quick Keys: clipboard write failed.", error);
        status.textContent = "Copy failed";
        return;
      }
    }

    status.textContent = "Copied!";
    button.classList.add("svq-copied");
    window.setTimeout(() => {
      status.textContent = "";
      button.classList.remove("svq-copied");
    }, 1400);
  }

  async function loadQuickKeys() {
    let response;
    try {
      response = await fetch(keysUrl);
    } catch (error) {
      console.error("Street View Quick Keys: could not load quick_keys.md.", error);
      return [];
    }
    if (!response.ok) {
      console.error(`Street View Quick Keys: quick_keys.md returned ${response.status}.`);
      return [];
    }

    const defaults = await response.text();
    let stored;
    try {
      stored = await chrome.storage.local.get(quickKeysStorageKey);
    } catch (error) {
      console.error("Street View Quick Keys: could not load customized prompts.", error);
      return parseQuickKeys(defaults);
    }
    return parseQuickKeys(stored[quickKeysStorageKey] ?? defaults);
  }

  function renderEntries(entries) {
    menu.replaceChildren();
    if (!entries.length) {
      console.error("Street View Quick Keys: no valid entries found in quick_keys.md.");
      return;
    }

    for (const entry of entries) {
      const button = document.createElement("button");
      button.className = "svq-option";
      button.type = "button";
      button.textContent = entry.label;
      button.title = entry.prompt;
      button.setAttribute("role", "menuitem");
      button.addEventListener("click", () => copyPrompt(entry.prompt, button, status));
      menu.append(button);
    }

    const customize = document.createElement("button");
    customize.className = "svq-option svq-customize";
    customize.type = "button";
    customize.textContent = "Customize";
    customize.setAttribute("aria-label", "Customize quick-key prompts");
    customize.setAttribute("role", "menuitem");
    customize.addEventListener("click", () => window.open(customizeUrl, "_blank", "noopener"));
    menu.append(customize);
  }

  async function createMenu() {
    host = document.createElement("div");
    host.id = hostId;
    host.innerHTML = `
      <button class="svq-trigger" type="button" aria-label="Open quick keys" aria-expanded="false">GG</button>
      <div class="svq-menu" role="menu"></div>
      <div class="svq-status" aria-live="polite"></div>
    `;

    menu = host.querySelector(".svq-menu");
    status = host.querySelector(".svq-status");
    renderEntries(await loadQuickKeys());

    const trigger = host.querySelector(".svq-trigger");
    let drag;
    let ignoreNextClick = false;
    let hoverCloseTimer;
    trigger.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const bounds = host.getBoundingClientRect();
      drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        left: bounds.left,
        top: bounds.top,
        moved: false,
      };
      trigger.setPointerCapture(event.pointerId);
    });
    trigger.addEventListener("pointermove", (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const deltaX = event.clientX - drag.startX;
      const deltaY = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(deltaX, deltaY) < 4) return;

      drag.moved = true;
      host.style.left = `${Math.max(0, Math.min(window.innerWidth - host.offsetWidth, drag.left + deltaX))}px`;
      host.style.top = `${Math.max(0, Math.min(window.innerHeight - host.offsetHeight, drag.top + deltaY))}px`;
      host.style.right = "auto";
      host.style.bottom = "auto";
      host.style.transform = "none";
    });
    trigger.addEventListener("pointerup", (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (drag.moved) {
        ignoreNextClick = true;
        try {
          localStorage.setItem(
            positionKey,
            JSON.stringify({
              left: host.getBoundingClientRect().left,
              top: host.getBoundingClientRect().top,
            }),
          );
        } catch (error) {
          console.error("Street View Quick Keys: could not save its position.", error);
        }
      }
      drag = undefined;
    });
    trigger.addEventListener("click", () => {
      if (ignoreNextClick) {
        ignoreNextClick = false;
        return;
      }
      const expanded = host.classList.toggle("svq-open");
      trigger.setAttribute("aria-expanded", String(expanded));
    });
    host.addEventListener("mouseenter", () => {
      window.clearTimeout(hoverCloseTimer);
      host.classList.add("svq-hover");
    });
    host.addEventListener("mouseleave", () => {
      hoverCloseTimer = window.setTimeout(() => {
        if (!host.classList.contains("svq-open")) host.classList.remove("svq-hover");
      }, 180);
    });
    document.body.append(host);
    try {
      const savedPosition = localStorage.getItem(positionKey);
      if (savedPosition) {
        const position = JSON.parse(savedPosition);
        if (Number.isFinite(position.left) && Number.isFinite(position.top)) {
          host.style.left = `${Math.max(0, Math.min(window.innerWidth - host.offsetWidth, position.left))}px`;
          host.style.top = `${Math.max(0, Math.min(window.innerHeight - host.offsetHeight, position.top))}px`;
          host.style.right = "auto";
          host.style.bottom = "auto";
          host.style.transform = "none";
        }
      }
    } catch (error) {
      console.error("Street View Quick Keys: could not restore its position.", error);
    }
    updateVisibility();
  }

  function updateVisibility() {
    if (host) host.hidden = !isStreetView();
  }

  function observePage() {
    updateVisibility();
    if (!observer && document.body) {
      let updateScheduled = false;
      observer = new MutationObserver(() => {
        if (updateScheduled) return;
        updateScheduled = true;
        window.requestAnimationFrame(() => {
          updateScheduled = false;
          updateVisibility();
        });
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  createMenu();
  chrome.storage.onChanged.addListener((changes, areaName) => {
    const change = changes.quickKeysMarkdown;
    if (areaName !== "local" || !change || !menu) return;
    fetch(keysUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`quick_keys.md returned ${response.status}`);
        return response.text();
      })
      .then((defaults) => renderEntries(parseQuickKeys(change.newValue ?? defaults)))
      .catch((error) => console.error("Street View Quick Keys: could not update prompts.", error));
  });
  observePage();
  window.addEventListener("popstate", updateVisibility);
  window.addEventListener("hashchange", updateVisibility);
  window.setInterval(updateVisibility, 1000);
})();
