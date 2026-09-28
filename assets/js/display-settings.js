// Display Settings (brightness / eye-comfort / dark mode).
// Lives as a card inside the "Settings" tab instead of a floating widget.
// Independent of the main app: preferences are applied on page load (so dark mode and
// brightness work even on the passcode screen) and stay local (never synced to the cloud).
(function () {
  var PREF_KEY = "_uiprefs_theme";
  var SETTINGS_TITLE = "Master Data & Operational Settings"; // h1 text of the Settings tab
  var CARD_ID = "gmDisplayCard";
  var STYLE_ID = "gmDarkStyle";

  function defaults() { return { brightness: 100, mode: "default", dark: false }; }

  function getPrefs() {
    try {
      var raw = window.localStorage.getItem(PREF_KEY);
      var p = raw ? JSON.parse(raw) : {};
      var d = defaults();
      return {
        brightness: typeof p.brightness === "number" ? p.brightness : d.brightness,
        mode: p.mode || d.mode,
        dark: !!p.dark
      };
    } catch (e) { return defaults(); }
  }
  function savePrefs(p) {
    try { window.localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch (e) {}
  }

  // Dark mode = inverted colors with hue rotated back (so gold stays gold, red stays red).
  // Photos/video/canvas are inverted a second time so they look normal.
  function ensureDarkStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent =
      "html.gm-dark img,html.gm-dark video,html.gm-dark canvas{filter:invert(1) hue-rotate(180deg);}" +
      "html.gm-dark .gm-overlay{filter:invert(1) hue-rotate(180deg);}" +
      "html.gm-dark{color-scheme:dark;}";
    document.head.appendChild(s);
  }

  function applyFilter(p) {
    ensureDarkStyle();
    var root = document.documentElement;
    root.classList.toggle("gm-dark", !!p.dark);
    var parts = [];
    if (p.dark) parts.push("invert(1) hue-rotate(180deg)");
    if (p.brightness !== 100) parts.push("brightness(" + (p.brightness / 100) + ")");
    if (p.mode === "warm") parts.push("sepia(15%) saturate(92%)");
    if (p.mode === "contrast") parts.push("contrast(115%) saturate(112%)");
    root.style.filter = parts.join(" ");
  }

  var prefs = getPrefs();

  // ---------- Settings-tab card ----------
  function btnStyle(active) {
    return "padding:9px 12px;border-radius:10px;cursor:pointer;text-align:left;font-size:13px;font-weight:600;" +
      "font-family:'Plus Jakarta Sans',-apple-system,Segoe UI,Roboto,sans-serif;color:#2C2A29;" +
      "border:1.5px solid " + (active ? "#C5A059" : "#EAE3D5") + ";" +
      "background:" + (active ? "#FBF5E6" : "#fff") + ";";
  }

  function buildCard() {
    var card = document.createElement("section");
    card.id = CARD_ID;
    card.style.cssText =
      "background:#fff;border:1px solid #EAE3D5;border-radius:16px;padding:22px 24px;margin:0 0 24px 0;" +
      "box-shadow:0 1px 3px rgba(0,0,0,.04);font-family:'Plus Jakarta Sans',-apple-system,Segoe UI,Roboto,sans-serif;color:#2C2A29;";
    card.innerHTML =
      '<div style="font-family:\'Playfair Display\',serif;font-weight:700;font-size:19px;margin-bottom:4px;">Display Settings</div>' +
      '<div style="font-size:12px;color:#6C655B;margin-bottom:18px;">Saved on this device only. Does not affect other users.</div>' +

      '<div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#A9853F;margin-bottom:8px;">Appearance</div>' +
      '<div id="gmThemeRow" style="display:flex;gap:8px;margin-bottom:20px;max-width:360px;">' +
      '<button type="button" data-theme="light" style="flex:1;">&#9728; Light</button>' +
      '<button type="button" data-theme="dark" style="flex:1;">&#9790; Dark</button>' +
      '</div>' +

      '<div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#A9853F;margin-bottom:8px;">Brightness &mdash; <span id="gmBrightVal"></span>%</div>' +
      '<input id="gmBrightSlider" type="range" min="50" max="100" style="width:100%;max-width:360px;display:block;margin-bottom:20px;accent-color:#C5A059;" />' +

      '<div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#A9853F;margin-bottom:8px;">Color mode</div>' +
      '<div id="gmModeRow" style="display:flex;flex-direction:column;gap:6px;max-width:360px;">' +
      '<button type="button" data-mode="default">Default</button>' +
      '<button type="button" data-mode="warm">Warm / Eye Comfort</button>' +
      '<button type="button" data-mode="contrast">High Contrast</button>' +
      '</div>';

    var slider = card.querySelector("#gmBrightSlider");
    var valLabel = card.querySelector("#gmBrightVal");
    var themeBtns = card.querySelectorAll("#gmThemeRow button");
    var modeBtns = card.querySelectorAll("#gmModeRow button");

    function refreshUI() {
      slider.value = prefs.brightness;
      valLabel.textContent = prefs.brightness;
      Array.prototype.forEach.call(themeBtns, function (b) {
        var active = (b.getAttribute("data-theme") === "dark") === prefs.dark;
        b.style.cssText = btnStyle(active) + "flex:1;";
      });
      Array.prototype.forEach.call(modeBtns, function (b) {
        b.style.cssText = btnStyle(b.getAttribute("data-mode") === prefs.mode);
      });
    }

    slider.addEventListener("input", function () {
      prefs.brightness = parseInt(slider.value, 10);
      valLabel.textContent = prefs.brightness;
      applyFilter(prefs);
      savePrefs(prefs);
    });
    Array.prototype.forEach.call(themeBtns, function (b) {
      b.addEventListener("click", function () {
        prefs.dark = b.getAttribute("data-theme") === "dark";
        applyFilter(prefs);
        savePrefs(prefs);
        refreshUI();
      });
    });
    Array.prototype.forEach.call(modeBtns, function (b) {
      b.addEventListener("click", function () {
        prefs.mode = b.getAttribute("data-mode");
        applyFilter(prefs);
        savePrefs(prefs);
        refreshUI();
      });
    });

    refreshUI();
    return card;
  }

  // Show the card only while the Settings tab is open; remove it on any other tab.
  function syncCard() {
    var h1 = document.querySelector("#main-app-header h1");
    var onSettings = !!(h1 && h1.textContent.trim() === SETTINGS_TITLE);
    var existing = document.getElementById(CARD_ID);
    if (!onSettings) {
      if (existing) existing.remove();
      return;
    }
    if (existing) return;
    var main = document.querySelector("main");
    if (!main) return;
    var host = main.firstElementChild || main;
    host.insertBefore(buildCard(), host.firstChild);
  }

  var scheduled = false;
  function scheduleSync() {
    if (scheduled) return;
    scheduled = true;
    (window.requestAnimationFrame || setTimeout)(function () {
      scheduled = false;
      syncCard();
    });
  }

  // Apply saved preferences as early as possible (no flash of light theme on reload).
  applyFilter(prefs);

  document.addEventListener("DOMContentLoaded", function () {
    applyFilter(prefs);
    new MutationObserver(scheduleSync).observe(document.body, { childList: true, subtree: true, characterData: true });
    scheduleSync();
  });
})();
