// Floating brightness / eye-comfort widget. Independent of the main app —
// works even on the passcode screen. Preferences stay local (never synced).
(function () {
  var PREF_KEY = "_uiprefs_theme";

  function getPrefs() {
    try {
      var raw = window.localStorage.getItem(PREF_KEY);
      return raw ? JSON.parse(raw) : { brightness: 100, mode: "default" };
    } catch (e) { return { brightness: 100, mode: "default" }; }
  }
  function savePrefs(p) {
    try { window.localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch (e) {}
  }
  function applyFilter(p) {
    if (p.brightness === 100 && p.mode === "default") {
      document.documentElement.style.filter = "";
      return;
    }
    var filter = "brightness(" + (p.brightness / 100) + ")";
    if (p.mode === "warm") filter += " sepia(15%) saturate(92%)";
    if (p.mode === "contrast") filter += " contrast(115%) saturate(112%)";
    document.documentElement.style.filter = filter;
  }

  var prefs = getPrefs();

  function buildWidget() {
    if (document.getElementById("displaySettingsBtn")) return;
    var btn = document.createElement("button");
    btn.id = "displaySettingsBtn";
    btn.textContent = "\u2699";
    btn.style.cssText = "position:fixed;bottom:16px;right:16px;width:46px;height:46px;border-radius:50%;background:#1B1918;color:#fff;border:none;font-size:19px;cursor:pointer;z-index:99998;box-shadow:0 4px 14px rgba(0,0,0,.35);";
    var panel = document.createElement("div");
    panel.style.cssText = "position:fixed;bottom:72px;right:16px;width:250px;background:#FAF7F2;border-radius:12px;padding:16px;box-shadow:0 12px 32px rgba(0,0,0,.35);z-index:99998;display:none;font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:13px;color:#2C2A29;";
    panel.innerHTML =
      '<div style="font-weight:700;margin-bottom:10px;">Display Settings</div>' +
      '<label style="display:block;margin-bottom:4px;color:#6C655B;">Brightness — <span id="brightnessVal">' + prefs.brightness + '</span>%</label>' +
      '<input id="brightnessSlider" type="range" min="50" max="100" style="width:100%;margin-bottom:14px;" />' +
      '<div style="display:flex;flex-direction:column;gap:6px;">' +
      '<button data-mode="default" style="padding:8px;border-radius:8px;border:1px solid #EAE3D5;background:#fff;cursor:pointer;text-align:left;">Default</button>' +
      '<button data-mode="warm" style="padding:8px;border-radius:8px;border:1px solid #EAE3D5;background:#fff;cursor:pointer;text-align:left;">Warm / Eye Comfort</button>' +
      '<button data-mode="contrast" style="padding:8px;border-radius:8px;border:1px solid #EAE3D5;background:#fff;cursor:pointer;text-align:left;">High Contrast</button>' +
      '</div>';
    document.body.appendChild(btn);
    document.body.appendChild(panel);

    var slider = panel.querySelector("#brightnessSlider");
    var valLabel = panel.querySelector("#brightnessVal");
    slider.value = prefs.brightness;
    slider.addEventListener("input", function () {
      prefs.brightness = parseInt(slider.value, 10);
      valLabel.textContent = prefs.brightness;
      applyFilter(prefs);
      savePrefs(prefs);
    });
    Array.prototype.forEach.call(panel.querySelectorAll("button[data-mode]"), function (b) {
      b.addEventListener("click", function () {
        prefs.mode = b.getAttribute("data-mode");
        applyFilter(prefs);
        savePrefs(prefs);
      });
    });
    btn.addEventListener("click", function () {
      panel.style.display = panel.style.display === "none" ? "block" : "none";
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    applyFilter(prefs);
    buildWidget();
  });
})();
