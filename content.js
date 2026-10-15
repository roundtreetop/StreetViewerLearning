(() => {
  const hostId = "street-view-quick-keys";
  const keysUrl = chrome.runtime.getURL("quick_keys.md");
  const customizeUrl = chrome.runtime.getURL("customize.html");
  const positionKey = "street-view-quick-keys-position";
  const quickKeysStorageKey = "quickKeysMarkdown";
  let host;
  let observer;
  let sceneResizeObserver;
  let observedScene;
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

  function getStreetViewBounds() {
    const scenes = document.querySelectorAll(".widget-scene, #scene");
    for (const scene of scenes) {
      const bounds = scene.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) continue;

      const left = Math.max(0, bounds.left);
      const top = Math.max(0, bounds.top);
      const right = Math.min(window.innerWidth, bounds.right);
      const bottom = Math.min(window.innerHeight, bounds.bottom);
      if (right > left && bottom > top) return { left, top, right, bottom };
    }

    return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  }

  function observeStreetViewScene() {
    if (!sceneResizeObserver) return;
    const scene = document.querySelector(".widget-scene") || document.querySelector("#scene");
    if (scene === observedScene) return;
    if (observedScene) sceneResizeObserver.unobserve(observedScene);
    observedScene = scene;
    if (scene) sceneResizeObserver.observe(scene);
  }

  function constrainHostPosition(left, top) {
    const bounds = getStreetViewBounds();
    const margin = 8;
    const width = host.querySelector(".svq-trigger").offsetWidth;
    const height = host.querySelector(".svq-trigger").offsetHeight;
    const minLeft = bounds.left + margin;
    const maxLeft = bounds.right - width - margin;
    const minTop = bounds.top + margin;
    const maxTop = bounds.bottom - height - margin;

    return {
      left: maxLeft < minLeft
        ? bounds.left + Math.max(0, (bounds.right - bounds.left - width) / 2)
        : Math.max(minLeft, Math.min(maxLeft, left)),
      top: maxTop < minTop
        ? bounds.top + Math.max(0, (bounds.bottom - bounds.top - height) / 2)
        : Math.max(minTop, Math.min(maxTop, top)),
    };
  }

  function positionHost(left, top) {
    const position = constrainHostPosition(left, top);
    host.style.left = `${position.left}px`;
    host.style.top = `${position.top}px`;
    host.style.right = "auto";
    host.style.bottom = "auto";
    host.style.transform = "none";
    return position;
  }

  function saveHostPosition() {
    const bounds = host.getBoundingClientRect();
    try {
      localStorage.setItem(positionKey, JSON.stringify({ left: bounds.left, top: bounds.top }));
    } catch (error) {
      console.error("Street View Quick Keys: could not save its position.", error);
    }
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
      positionHost(drag.left + deltaX, drag.top + deltaY);
    });
    trigger.addEventListener("pointerup", (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (drag.moved) {
        ignoreNextClick = true;
        saveHostPosition();
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
          positionHost(position.left, position.top);
        } else {
          positionHostFromDefault();
        }
      } else {
        positionHostFromDefault();
      }
    } catch (error) {
      console.error("Street View Quick Keys: could not restore its position.", error);
      positionHostFromDefault();
    }
    updateVisibility();
  }

  function positionHostFromDefault() {
    const bounds = getStreetViewBounds();
    const trigger = host.querySelector(".svq-trigger");
    positionHost(
      bounds.right - 24 - trigger.offsetWidth,
      bounds.top + (bounds.bottom - bounds.top - trigger.offsetHeight) / 2,
    );
  }

  function updateVisibility() {
    if (!host) return;
    observeStreetViewScene();
    const streetView = isStreetView();
    host.hidden = !streetView;
    if (streetView) {
      const position = positionHost(host.getBoundingClientRect().left, host.getBoundingClientRect().top);
      if (position.left !== host.getBoundingClientRect().left || position.top !== host.getBoundingClientRect().top) {
        saveHostPosition();
      }
    }
  }

  function observePage() {
    updateVisibility();
    if (!sceneResizeObserver && "ResizeObserver" in window) {
      sceneResizeObserver = new ResizeObserver(updateVisibility);
      observeStreetViewScene();
    }
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
  window.addEventListener("resize", updateVisibility);
  window.setInterval(updateVisibility, 1000);
})();
