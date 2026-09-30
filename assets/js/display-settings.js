// Display Settings (brightness / eye-comfort / dark mode).
// Lives as a card inside the "Settings" tab instead of a floating widget.
// Independent of the main app: preferences are applied on page load (so dark mode and
// brightness work even on the passcode screen) and stay local (never synced to the cloud).
//
// v5: Dark mode is now a REAL theme. This file only toggles <html data-theme="dark|light">;
//     the palette lives in /assets/css/dark-theme.css. No more invert() filter.
//     Brightness and eye-comfort/contrast modes still use a CSS filter on <html>.
(function () {
  var PREF_KEY = "_uiprefs_theme"; // unchanged, so saved preferences carry over
  var SETTINGS_TITLE = "Master Data & Operational Settings"; // h1 text of the Settings tab
  var CARD_ID = "gmDisplayCard";

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

  function applyTheme(p) {
    var root = document.documentElement;
    root.setAttribute("data-theme", p.dark ? "dark" : "light");

    var parts = [];
    if (p.brightness !== 100) parts.push("brightness(" + (p.brightness / 100) + ")");
    if (p.mode === "warm") parts.push("sepia(15%) saturate(92%)");
    if (p.mode === "contrast") parts.push("contrast(115%) saturate(112%)");
    root.style.filter = parts.join(" ");
  }

  var prefs = getPrefs();

  // ---------- Settings-tab card ----------
  // Colors use CSS variables (defined in dark-theme.css) with light-mode fallbacks,
  // so the card follows the theme without any JS color logic.
  var FONT = "'Plus Jakarta Sans',-apple-system,Segoe UI,Roboto,sans-serif";

  function btnStyle(active) {
    return "padding:9px 12px;border-radius:10px;cursor:pointer;text-align:left;font-size:13px;font-weight:600;" +
      "font-family:" + FONT + ";color:var(--gm-text,#2C2A29);" +
      "border:1.5px solid " + (active ? "#C5A059" : "var(--gm-border,#EAE3D5)") + ";" +
      "background:" + (active ? "var(--gm-active,#FBF5E6)" : "var(--gm-surface,#fff)") + ";";
  }

  var LABEL = "font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;" +
    "color:var(--gm-gold,#A9853F);margin-bottom:8px;";

  function buildCard() {
    var card = document.createElement("section");
    card.id = CARD_ID;
    card.style.cssText =
      "background:var(--gm-surface,#fff);border:1px solid var(--gm-border,#EAE3D5);border-radius:16px;" +
      "padding:22px 24px;margin:0 0 24px 0;box-shadow:0 1px 3px rgba(0,0,0,.04);" +
      "font-family:" + FONT + ";color:var(--gm-text,#2C2A29);";
    card.innerHTML =
      '<div style="font-family:\'Playfair Display\',serif;font-weight:700;font-size:19px;margin-bottom:4px;">Display Settings</div>' +
      '<div style="font-size:12px;color:var(--gm-muted,#6C655B);margin-bottom:18px;">Saved on this device only. Does not affect other users.</div>' +

      '<div style="' + LABEL + '">Appearance</div>' +
      '<div id="gmThemeRow" style="display:flex;gap:8px;margin-bottom:20px;max-width:360px;">' +
      '<button type="button" data-theme="light" style="flex:1;">&#9728; Light</button>' +
      '<button type="button" data-theme="dark" style="flex:1;">&#9790; Dark</button>' +
      '</div>' +

      '<div style="' + LABEL + '">Brightness &mdash; <span id="gmBrightVal"></span>%</div>' +
      '<input id="gmBrightSlider" type="range" min="50" max="100" style="width:100%;max-width:360px;display:block;margin-bottom:20px;accent-color:#C5A059;" />' +

      '<div style="' + LABEL + '">Color mode</div>' +
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
      applyTheme(prefs);
      savePrefs(prefs);
    });
    Array.prototype.forEach.call(themeBtns, function (b) {
      b.addEventListener("click", function () {
        prefs.dark = b.getAttribute("data-theme") === "dark";
        applyTheme(prefs);
        savePrefs(prefs);
        refreshUI();
      });
    });
    Array.prototype.forEach.call(modeBtns, function (b) {
      b.addEventListener("click", function () {
        prefs.mode = b.getAttribute("data-mode");
        applyTheme(prefs);
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
  applyTheme(prefs);

  document.addEventListener("DOMContentLoaded", function () {
    applyTheme(prefs);
    new MutationObserver(scheduleSync).observe(document.body, { childList: true, subtree: true, characterData: true });
    scheduleSync();
  });
})();
