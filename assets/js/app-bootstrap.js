// App bootstrap: passcode gate, Supabase hydrate/sync, presence widget, sync badge.
// Runs before the compiled app bundle. Depends on config.js (USER_DIRECTORY) being
// loaded first. Kept as plain IIFE (not a module) to match its original behavior.
(function () {
  var UNLOCK_KEY = "__gate_unlocked_until";
  var DISPLAY_KEY = "_uiprefs_theme";
  var API_PASSCODE_KEY = "__api_passcode";
  var PENDING_KEY = "__pending_sync_keys";
  var USER_IDX_KEY = "__user_idx";
  var RECORDS_KEY = "eod_matrix_records_v3";
  // The half-typed Daily Entry form is personal to one person on one device. It must never be
  // uploaded (two auditors share the database, and it can contain a multi-MB photo).
  var DRAFT_KEY = "eod_matrix_daily_draft_v3";

  function isSystemKey(k) { return k === UNLOCK_KEY || k === DISPLAY_KEY || k === API_PASSCODE_KEY || k === PENDING_KEY || k === DRAFT_KEY; }

  function getStoredPasscode() {
    return sessionStorage.getItem(API_PASSCODE_KEY) || "";
  }
  window.getStoredPasscode = getStoredPasscode;

  // Uploads a compressed evidence photo (base64 data URL) to Supabase Storage and
  // returns a signed URL string, so the caller can swap it in for the base64 in
  // React state. Never throws to the caller on failure -- callers should keep the
  // base64 as a fallback if this rejects, so photo capture still works even if a
  // single upload call has a problem.
  window.__uploadEvidencePhoto = function (dataUrl) {
    return fetch("/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-passcode": getStoredPasscode() },
      body: JSON.stringify({ dataUrl: dataUrl }),
    }).then(function (res) {
      if (!res.ok) throw new Error("evidence photo upload failed: " + res.status);
      return res.json();
    }).then(function (data) {
      return data && data.url ? data.url : null;
    });
  };
  // Purge any stale passcode left over from the old "remember on this device" feature.
  try { window.localStorage.removeItem(API_PASSCODE_KEY); } catch (e) {}
  try { window.localStorage.removeItem(UNLOCK_KEY); } catch (e) {}

  function startApp() {
    // Deferred module load: the compiled app only starts after the passcode
    // gate has passed and initial data has hydrated (see loadThenStart below).
    // Using a real dynamic import() (instead of copying a <script type="text/plain">
    // blob into a new <script> tag) gives the bundle a proper file the browser
    // can cache and show correctly in DevTools, while preserving the same
    // "load on demand" timing as before.
    import("/assets/js/app.bundle.js").catch(function (err) {
      console.error("Failed to load application bundle:", err);
    });
  }

  // ---- Shared visual language for every pre-bundle overlay (gate, failure, toasts, ----
  // ---- presence pills, sync badge) so the app looks considered the instant it opens. ----
  var GM_STYLE_ID = "gmChromeStyles";
  function ensureChromeStyles() {
    if (document.getElementById(GM_STYLE_ID)) return;
    var css =
      "@keyframes gmFadeIn{from{opacity:0}to{opacity:1}}" +
      "@keyframes gmRise{from{opacity:0;transform:translateY(14px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}" +
      "@keyframes gmShake{10%,90%{transform:translateX(-1px)}20%,80%{transform:translateX(2px)}30%,50%,70%{transform:translateX(-4px)}40%,60%{transform:translateX(4px)}}" +
      "@keyframes gmSpin{to{transform:rotate(360deg)}}" +
      "@keyframes gmGlow{0%,100%{opacity:.55}50%{opacity:.9}}" +
      "@keyframes gmSlideUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}" +
      ".gm-overlay{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;font-family:'Plus Jakarta Sans',-apple-system,Segoe UI,Roboto,sans-serif;" +
      "background:#15130F;background-image:radial-gradient(circle at 50% 18%,rgba(197,160,89,.16),transparent 55%),repeating-linear-gradient(0deg,rgba(255,255,255,.025) 0px,rgba(255,255,255,.025) 1px,transparent 1px,transparent 3px);animation:gmFadeIn .35s ease-out}" +
      ".gm-orb{position:absolute;width:420px;height:420px;border-radius:50%;background:radial-gradient(circle,rgba(197,160,89,.35),transparent 70%);filter:blur(10px);top:-140px;animation:gmGlow 5s ease-in-out infinite;pointer-events:none}" +
      ".gm-card{position:relative;background:#FAF7F2;width:340px;max-width:92vw;border-radius:18px;padding:36px 32px 28px;text-align:center;box-shadow:0 30px 80px -20px rgba(0,0,0,.65),0 0 0 1px rgba(197,160,89,.15);animation:gmRise .45s cubic-bezier(.16,1,.3,1)}" +
      ".gm-card::before{content:'';position:absolute;top:0;left:16px;right:16px;height:3px;border-radius:0 0 3px 3px;background:linear-gradient(90deg,transparent,#C5A059,transparent)}" +
      ".gm-logo{width:52px;height:52px;border-radius:50%;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;background:linear-gradient(145deg,#D9BA7C,#A9853F);box-shadow:inset 0 1px 1px rgba(255,255,255,.5),0 8px 18px -6px rgba(169,133,63,.6);font-family:'Cinzel',serif;font-weight:700;font-size:13px;letter-spacing:.04em;color:#2C2110}" +
      ".gm-eyebrow{font-family:'Cinzel',serif;font-size:9.5px;font-weight:600;letter-spacing:.22em;color:#A9853F;text-transform:uppercase;margin-bottom:6px}" +
      ".gm-title{font-family:'Cinzel',serif;font-weight:700;font-size:17px;letter-spacing:.045em;color:#2C2A29;margin-bottom:4px}" +
      ".gm-subtitle{font-size:12px;color:#6C655B;margin-bottom:22px}" +
      ".gm-field{position:relative;margin-bottom:6px}" +
      ".gm-field svg{position:absolute;left:13px;top:50%;transform:translateY(-50%);opacity:.45;pointer-events:none}" +
      ".gm-input{width:100%;padding:12px 14px 12px 38px;border:1.5px solid #EAE3D5;border-radius:10px;font-size:15px;font-family:'JetBrains Mono',monospace;letter-spacing:.08em;outline:none;box-sizing:border-box;background:#fff;color:#2C2A29;transition:border-color .2s,box-shadow .2s}" +
      ".gm-input:focus{border-color:#C5A059;box-shadow:0 0 0 4px rgba(197,160,89,.18)}" +
      ".gm-error{color:#B53D43;font-size:11.5px;font-weight:600;min-height:16px;margin-top:9px}" +
      ".gm-shake{animation:gmShake .4s}" +
      ".gm-btn{margin-top:10px;width:100%;padding:12px;background:linear-gradient(145deg,#2C2A29,#17150F);color:#F5EFE2;border:none;border-radius:10px;font-weight:700;font-size:13.5px;letter-spacing:.03em;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 8px 20px -8px rgba(0,0,0,.5);transition:transform .15s,box-shadow .15s}" +
      ".gm-btn:hover{transform:translateY(-1px);box-shadow:0 12px 24px -8px rgba(0,0,0,.55)}" +
      ".gm-btn:active{transform:translateY(0)}" +
      ".gm-btn:disabled{opacity:.75;cursor:default;transform:none}" +
      ".gm-spinner{width:14px;height:14px;border-radius:50%;border:2px solid rgba(245,239,226,.3);border-top-color:#F5EFE2;animation:gmSpin .7s linear infinite}" +
      ".gm-footer{margin-top:20px;font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:#B7AF9E}" +
      ".gm-toast{position:fixed;left:14px;bottom:16px;z-index:99999;max-width:360px;font-family:'Plus Jakarta Sans',-apple-system,Segoe UI,Roboto,sans-serif;font-size:12px;font-weight:600;line-height:1.5;padding:12px 15px;border-radius:12px;box-shadow:0 10px 30px -8px rgba(0,0,0,.3);animation:gmSlideUp .3s ease-out;display:flex;gap:9px;align-items:flex-start;transition:opacity .3s,transform .3s}" +
      ".gm-pill{display:flex;align-items:center;gap:7px;padding:6px 13px;border-radius:20px;background:rgba(250,247,242,.92);backdrop-filter:blur(6px);box-shadow:0 6px 16px -4px rgba(0,0,0,.18);font-family:'Plus Jakarta Sans',sans-serif;font-size:11.5px;font-weight:600;color:#2C2A29;border:1px solid #EAE3D5;transition:box-shadow .2s}" +
      ".gm-dot{width:7px;height:7px;border-radius:50%;background:#C9C2B4;display:inline-block;transition:background .35s,box-shadow .35s}" +
      ".gm-dot.gm-online{box-shadow:0 0 0 3px rgba(47,174,102,.18)}" +
      ".gm-badge{position:fixed;z-index:99999;font-family:'Plus Jakarta Sans',sans-serif;font-size:11.5px;font-weight:700;padding:7px 14px;border-radius:20px;box-shadow:0 8px 20px -6px rgba(0,0,0,.22);display:none;align-items:center;gap:7px;transition:opacity .3s,transform .3s}";
    var style = document.createElement("style");
    style.id = GM_STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  var LOCK_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2C2A29" stroke-width="2"><rect x="4" y="11" width="16" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

  // Shown when the cloud could not be reached on a device that has never stored any data.
  // Starting the app here would display the built-in SAMPLE records and the first save would
  // upload them into the real database, so we refuse to start and offer a retry instead.
  function showLoadFailure() {
    ensureChromeStyles();
    var overlay = document.createElement("div");
    overlay.className = "gm-overlay";
    overlay.style.zIndex = "100001";
    overlay.innerHTML =
      '<div class="gm-orb"></div>' +
      '<div class="gm-card">' +
      '<div class="gm-logo">EOD</div>' +
      '<div class="gm-title" style="font-size:15px;">Could not load your data</div>' +
      '<div style="font-size:12.5px;color:#6C655B;margin:10px 0 20px;line-height:1.55;">The cloud database did not respond. To protect your records the app will not start with an empty local copy. Check your internet connection and try again.</div>' +
      '<button id="retryLoadBtn" class="gm-btn"><span>Retry connection</span></button>' +
      '<div class="gm-footer">Audit-grade access &middot; data integrity protected</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.querySelector("#retryLoadBtn").addEventListener("click", function (e) {
      var btn = e.currentTarget;
      btn.disabled = true;
      btn.innerHTML = '<span class="gm-spinner"></span><span>Retrying&hellip;</span>';
      overlay.remove();
      loadThenStart();
    });
  }

  function showOfflineNotice() {
    ensureChromeStyles();
    var el = document.createElement("div");
    el.className = "gm-toast";
    el.style.background = "#FFF4DC";
    el.style.color = "#8A6A1F";
    el.innerHTML = '<span style="font-size:14px;line-height:1;">\u26A0</span><span>Could not reach the cloud. Showing the last data saved on this device. Reload once you are back online to get the latest records.</span>';
    document.body.appendChild(el);
    setTimeout(function () {
      el.style.opacity = "0";
      el.style.transform = "translateY(10px)";
      setTimeout(function () { el.remove(); }, 300);
    }, 11700);
  }

  function loadThenStart() {
    hydrateFromSupabase().then(function (ok) {
      if (!ok && window.localStorage.getItem(RECORDS_KEY) === null) { showLoadFailure(); return; }
      if (!ok) showOfflineNotice();
      startApp();
    });
  }

  function launchApp() {
    buildSyncBadge();
    buildPendingBanner();
    updatePendingBanner();
    buildPresenceWidget();
    installSupabaseSync();
    applyRoleTabRestrictions();
    loadThenStart();
  }

  // Enforces ROLE_TAB_ACCESS (config.js) on the sidebar rendered by the compiled app bundle.
  // The bundle itself has no notion of roles, so this works purely from the outside:
  //   1. Injects CSS that hides the sidebar buttons for tabs the role isn't allowed to see.
  //   2. Hides known cross-navigation shortcuts (e.g. the header's "New Daily Entry" button)
  //      that jump straight into a hidden tab, bypassing the sidebar.
  //   3. Watches the page (MutationObserver) for the rare case some other in-app link still
  //      lands the user on a hidden tab, and immediately bounces them back to the first
  //      allowed tab so the hidden content is never left on screen.
  // Note: this is a UI-level restriction only. It controls what a limited account SEES;
  // it does not by itself restrict what the /api/data endpoint returns to that passcode.
  function applyRoleTabRestrictions() {
    var user = resolveCurrentUser();
    var role = user && user.role;
    if (!role || typeof ROLE_TAB_ACCESS === "undefined" || !ROLE_TAB_ACCESS[role]) return; // full/unlisted role: no restriction
    var allowed = ROLE_TAB_ACCESS[role];

    // Tab id -> the exact header title the bundle shows for that tab (used to detect a leak).
    var TAB_TITLES = {
      overview: "Executive Overview & Operations Matrix",
      daily: "Daily EOD Matrix Entry & Verification",
      monthly: "Monthly Variance & Trend Breakdown",
      tracker: "Remediation Action Items & Audit Tracker",
      staff: "Personnel Monitoring & Risk Classification",
      records: "Historical EOD Records Audit Log",
      settings: "Master Data & Operational Settings"
    };
    var fallbackTabId = allowed[0] || "overview";
    var blockedTitles = {};
    Object.keys(TAB_TITLES).forEach(function (id) {
      if (allowed.indexOf(id) === -1) blockedTitles[TAB_TITLES[id]] = true;
    });

    // 1) Hide the sidebar buttons for blocked tabs.
    var css = "";
    Object.keys(TAB_TITLES).forEach(function (id) {
      if (allowed.indexOf(id) === -1) css += "#nav-tab-" + id + "{display:none !important;}\n";
    });
    var style = document.createElement("style");
    style.id = "role-tab-restrictions";
    style.textContent = css;
    document.head.appendChild(style);

    // 2) Hide known shortcut buttons that skip the sidebar entirely and jump into a blocked tab.
    //    ("New Daily Entry" lives in the header on every tab; "Audit" is the Overview page's
    //    "Top Variance Branch" card button — both jump straight into the Daily EOD Matrix tab.)
    var SHORTCUT_TEXTS = ["New Daily Entry", "Audit"];

    function sweepShortcuts() {
      SHORTCUT_TEXTS.forEach(function (txt) {
        document.querySelectorAll("button").forEach(function (btn) {
          if (btn.textContent && btn.textContent.trim() === txt) btn.style.display = "none";
        });
      });
    }

    // 3) Safety net: if the visible page title matches a blocked tab, hide the content instantly
    // and click back to an allowed tab.
    function enforceActiveTab() {
      var h1 = document.querySelector("#main-app-header h1");
      var main = document.querySelector("main");
      if (h1 && blockedTitles[h1.textContent.trim()]) {
        if (main) main.style.visibility = "hidden";
        var fallbackBtn = document.getElementById("nav-tab-" + fallbackTabId);
        if (fallbackBtn) fallbackBtn.click();
      } else if (main) {
        main.style.visibility = "";
      }
    }

    function sweep() {
      sweepShortcuts();
      enforceActiveTab();
    }

    var observer = new MutationObserver(sweep);
    observer.observe(document.body, { childList: true, subtree: true });
    sweep();
  }

  var currentUser = null; // {slug, name}
  function resolveCurrentUser() {
    var idx = parseInt(sessionStorage.getItem(USER_IDX_KEY), 10);
    return isNaN(idx) ? null : (USER_DIRECTORY[idx] || null);
  }

  function buildPresenceWidget() {
    ensureChromeStyles();
    currentUser = resolveCurrentUser();
    var bar = document.createElement("div");
    bar.style.cssText = "position:fixed;top:80px;right:14px;z-index:99999;display:flex;gap:8px;font-family:'Plus Jakarta Sans',-apple-system,Segoe UI,Roboto,sans-serif;";
    document.body.appendChild(bar);

    var pillEls = {};
    USER_DIRECTORY.forEach(function (u) {
      var pill = document.createElement("div");
      pill.className = "gm-pill";
      var dot = document.createElement("span");
      dot.className = "gm-dot";
      var label = document.createElement("span");
      label.textContent = u.name + (currentUser && currentUser.slug === u.slug ? " (you)" : "");
      pill.appendChild(dot);
      pill.appendChild(label);
      bar.appendChild(pill);
      pillEls[u.slug] = dot;
    });

    function sendHeartbeat() {
      if (!currentUser) return;
      fetch("/api/data", {
        method: "POST",
        headers: { "x-passcode": getStoredPasscode(), "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "presence:" + currentUser.slug,
          value: JSON.stringify({ name: currentUser.name, ts: Date.now() })
        })
      }).catch(function () {});
    }

    function pollPresence() {
      fetch("/api/data?presence=1", { headers: { "x-passcode": getStoredPasscode() } })
        .then(function (res) { return res.ok ? res.json() : []; })
        .then(function (rows) {
          var now = Date.now();
          var seen = {};
          (rows || []).forEach(function (r) {
            var slug = r.key.replace("presence:", "");
            try {
              var info = JSON.parse(r.value);
              seen[slug] = (now - info.ts) < 45000; // online if heartbeat within last 45s
            } catch (e) {}
          });
          Object.keys(pillEls).forEach(function (slug) {
            pillEls[slug].style.background = seen[slug] ? "#2FAE66" : "#C9C2B4";
            pillEls[slug].classList.toggle("gm-online", !!seen[slug]);
          });
        }).catch(function () {});
    }

    if (currentUser) {
      sendHeartbeat();
      setInterval(sendHeartbeat, 20000);
    }
    pollPresence();
    setInterval(pollPresence, 15000);
  }

  var syncBadgeEl = null;
  var syncBadgeHideTimer = null;
  function buildSyncBadge() {
    ensureChromeStyles();
    syncBadgeEl = document.createElement("div");
    syncBadgeEl.className = "gm-badge";
    syncBadgeEl.style.top = "124px";
    syncBadgeEl.style.right = "14px";
    document.body.appendChild(syncBadgeEl);
  }
  function setSyncStatus(status) {
    if (!syncBadgeEl) return;
    clearTimeout(syncBadgeHideTimer);
    syncBadgeEl.style.display = "flex";
    syncBadgeEl.style.opacity = "1";
    syncBadgeEl.style.transform = "translateY(0)";
    if (status === "pending" || status === "saving") {
      syncBadgeEl.style.background = "#FFF4DC";
      syncBadgeEl.style.color = "#8A6A1F";
      syncBadgeEl.innerHTML = status === "saving"
        ? '<span class="gm-spinner" style="border-color:rgba(138,106,31,.3);border-top-color:#8A6A1F;"></span><span>Saving to cloud&hellip;</span>'
        : "<span>&#9679;</span><span>Unsaved changes</span>";
    } else if (status === "saved") {
      syncBadgeEl.style.background = "#E4F5EA";
      syncBadgeEl.style.color = "#1C7A42";
      syncBadgeEl.innerHTML = "<span>&#10003;</span><span>Saved to cloud</span>";
      syncBadgeHideTimer = setTimeout(function () {
        syncBadgeEl.style.opacity = "0";
        syncBadgeEl.style.transform = "translateY(-6px)";
        setTimeout(function () { syncBadgeEl.style.display = "none"; }, 300);
      }, 2200);
    } else if (status === "error") {
      syncBadgeEl.style.background = "#FCE4E4";
      syncBadgeEl.style.color = "#B53D43";
      syncBadgeEl.innerHTML = "<span>&#9888;</span><span>Not saved — check connection</span>";
    }
  }

  // ---- Persistent pending-sync tracking (tested in isolation before integration) ----
  // Guarantees an unconfirmed change is recorded in real localStorage the instant it
  // happens, so it survives a tab close/crash and is never silently discarded.
  function makePendingTracker(storage, pendingKey, notifyChange) {
    function load() {
      try {
        var raw = storage.getItem(pendingKey);
        var arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
      } catch (e) { return []; }
    }
    function save(arr) {
      try { storage.setItem(pendingKey, JSON.stringify(arr)); } catch (e) {}
    }
    return {
      mark: function (key) {
        var arr = load();
        if (arr.indexOf(key) === -1) { arr.push(key); save(arr); }
        if (notifyChange) notifyChange(load());
      },
      clear: function (key) {
        var arr = load();
        var idx = arr.indexOf(key);
        if (idx !== -1) { arr.splice(idx, 1); save(arr); }
        if (notifyChange) notifyChange(load());
      },
      isPending: function (key) { return load().indexOf(key) !== -1; },
      list: function () { return load(); }
    };
  }

  var pendingBannerEl = null;
  function buildPendingBanner() {
    pendingBannerEl = document.createElement("div");
    pendingBannerEl.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:100000;background:#B53D43;color:#fff;font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-weight:700;font-size:13px;padding:10px 16px;text-align:center;box-shadow:0 2px 10px rgba(0,0,0,.3);display:none;";
    pendingBannerEl.textContent = "\u26A0 Not saved to cloud yet \u2014 please check your internet connection. Do not close this tab.";
    document.body.appendChild(pendingBannerEl);
  }
  function updatePendingBanner(currentList) {
    if (!pendingBannerEl) return;
    var list = currentList || pendingTracker.list();
    pendingBannerEl.style.display = list.length > 0 ? "block" : "none";
  }
  var pendingTracker = makePendingTracker(window.localStorage, PENDING_KEY, function (list) {
    updatePendingBanner(list);
  });

  var lastKnownSnapshot = {}; // key -> Map(id -> serialized JSON) for decomposable arrays
  // Values the browser refused to store (quota exceeded) but that still must reach the cloud.
  var memValues = {};
  // Arrays that the cloud still holds as ONE legacy whole-array row. They are migrated to per-record
  // rows on the next save (every record is pushed), and only then is the legacy row deleted.
  var legacyRows = {};

  function tryDecompose(rawValue) {
    try {
      var parsed = JSON.parse(rawValue);
      if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(function (it) { return it && typeof it === "object" && it.id != null; })) {
        var map = new Map();
        parsed.forEach(function (it) { map.set(String(it.id), JSON.stringify(it)); });
        return map;
      }
      if (Array.isArray(parsed) && parsed.length === 0) return new Map(); // empty array is decomposable too
    } catch (e) {}
    return null; // not a decomposable array (object/string/etc) -> whole-value sync
  }

  function installSupabaseSync() {
    var origSetItem = window.localStorage.setItem.bind(window.localStorage);
    var origRemoveItem = window.localStorage.removeItem.bind(window.localStorage);
    var pending = {};
    var timer = null;

    function headers(extra) {
      return Object.assign({
        "x-passcode": getStoredPasscode()
      }, extra || {});
    }
    function scheduleFlush() {
      clearTimeout(timer);
      setSyncStatus("pending");
      timer = setTimeout(flush, 800);
    }
    function currentValue(key) {
      return Object.prototype.hasOwnProperty.call(memValues, key) ? memValues[key] : window.localStorage.getItem(key);
    }
    function flush() {
      var keys = Object.keys(pending);
      pending = {};
      if (keys.length === 0) return;
      setSyncStatus("saving");
      var keyTaskMap = {};
      var decomposedKeys = {};

      keys.forEach(function (key) {
        if (isSystemKey(key)) return;
        var value = currentValue(key);
        var tasksForKey = [];

        if (value === null) {
          // whole key removed. A record is only forgotten once the server confirmed ITS deletion,
          // so a failed request is retried instead of leaving the record behind in the cloud.
          var snap = lastKnownSnapshot[key];
          if (snap) {
            Array.from(snap.keys()).forEach(function (id) {
              tasksForKey.push(fetch("/api/data?key=" + encodeURIComponent(key + "::" + id), { method: "DELETE", headers: headers() }).then(function (res) {
                if (res.ok) snap.delete(id);
                return res;
              }));
            });
          }
          tasksForKey.push(fetch("/api/data?key=" + encodeURIComponent(key), { method: "DELETE", headers: headers() }));
          delete legacyRows[key];
          keyTaskMap[key] = tasksForKey;
          return;
        }

        var newMap = tryDecompose(value);
        if (newMap) {
          decomposedKeys[key] = true;
          var oldMap = lastKnownSnapshot[key];
          if (!oldMap) { oldMap = new Map(); lastKnownSnapshot[key] = oldMap; }
          newMap.forEach(function (json, id) {
            if (oldMap.get(id) !== json) {
              tasksForKey.push(fetch("/api/data", {
                method: "POST",
                headers: headers({ "Content-Type": "application/json" }),
                body: JSON.stringify({ key: key + "::" + id, value: json })
              }).then(function (res) {
                // CRITICAL: only remember this record as "confirmed saved" once the server accepted it,
                // otherwise a failed push would be forgotten and never retried.
                if (res.ok) oldMap.set(id, json);
                return res;
              }));
            }
          });
          Array.from(oldMap.keys()).forEach(function (id) {
            if (!newMap.has(id)) {
              tasksForKey.push(fetch("/api/data?key=" + encodeURIComponent(key + "::" + id), { method: "DELETE", headers: headers() }).then(function (res) {
                if (res.ok) oldMap.delete(id);
                return res;
              }));
            }
          });
        } else {
          // not a decomposable array (plain object/string) -> sync as a single whole value
          tasksForKey.push(fetch("/api/data", {
            method: "POST",
            headers: headers({ "Content-Type": "application/json" }),
            body: JSON.stringify({ key: key, value: value })
          }));
        }
        keyTaskMap[key] = tasksForKey;
      });

      var allKeys = Object.keys(keyTaskMap);
      if (allKeys.length === 0) { setSyncStatus("saved"); return; }

      var anyFailed = false;
      var settled = 0;
      function done() {
        settled++;
        if (settled === allKeys.length) setSyncStatus(anyFailed ? "error" : "saved");
      }
      allKeys.forEach(function (key) {
        Promise.all(keyTaskMap[key]).then(function (results) {
          var failed = results.some(function (r) { return r && !r.ok; });
          if (failed) {
            anyFailed = true;
          } else {
            pendingTracker.clear(key); // only clear once every sub-task for this key is confirmed saved
            if (legacyRows[key] && decomposedKeys[key]) {
              // Every record now exists as its own row, so the old whole-array row can go. Leaving it
              // would bring deleted records back the moment the last per-record row is removed.
              delete legacyRows[key];
              fetch("/api/data?key=" + encodeURIComponent(key), { method: "DELETE", headers: headers() }).then(function (res) {
                if (!res.ok) legacyRows[key] = true;
              }, function () { legacyRows[key] = true; });
            }
          }
          done();
        }, function () {
          anyFailed = true;
          done();
        });
      });
    }
    var storageFullWarned = false;
    function warnStorageFull() {
      if (storageFullWarned) return;
      storageFullWarned = true;
      window.alert("Your device storage is full, so the latest change could not be stored on this device.\n\nIt is still being sent to the cloud. Keep this tab open until the badge shows \"Saved to cloud\". Removing large photo attachments will free up space.");
    }
    window.localStorage.setItem = function (key, value) {
      if (isSystemKey(key)) {
        // System keys (draft, session prefs) are never synced to the cloud, so there is no
        // "still being saved to the cloud" fallback for them. If the device quota is full,
        // the write must be swallowed here rather than thrown -- otherwise it escapes as an
        // uncaught exception into whatever autosave effect called setItem (e.g. the Daily
        // Entry draft autosave), which can silently break that effect for the rest of the
        // session. Losing one draft-save write is far better than that.
        try { origSetItem(key, value); } catch (e) {}
        return;
      }
      try {
        origSetItem(key, value);
        delete memValues[key];
      } catch (e) {
        // Quota exceeded. Never lose the change silently: keep it in memory and still push it to the cloud.
        memValues[key] = String(value);
        warnStorageFull();
      }
      pendingTracker.mark(key); // persist "unconfirmed" marker to real storage immediately, before the debounce
      pending[key] = true;
      scheduleFlush();
    };
    window.localStorage.removeItem = function (key) {
      origRemoveItem(key);
      if (isSystemKey(key)) return;
      delete memValues[key];
      pendingTracker.mark(key);
      pending[key] = true;
      scheduleFlush();
    };

    // Warn while ANY change is unconfirmed (including saves in flight or failed). `pending` alone is
    // emptied the moment a flush starts, so it cannot be used for this.
    window.addEventListener("beforeunload", function (e) {
      if (pendingTracker.list().length > 0) {
        e.preventDefault();
        e.returnValue = "";
      }
    });

    // Fix 1 (crash recovery): if a previous session left keys marked pending
    // (tab closed/crashed before cloud confirmed), retry pushing them now.
    var leftoverPending = pendingTracker.list();
    if (leftoverPending.length > 0) {
      leftoverPending.forEach(function (key) { pending[key] = true; });
      scheduleFlush();
    }

    // Keep trying until it's really in: even if the tab stays open (no reload),
    // any entry that failed to reach the cloud is retried automatically every
    // 12 seconds, for as long as it remains unconfirmed. This does not stop on
    // its own — it only stops once every pending item is actually saved.
    setInterval(function () {
      var stillPending = pendingTracker.list();
      if (stillPending.length === 0) return;
      stillPending.forEach(function (key) { pending[key] = true; });
      clearTimeout(timer);
      flush();
    }, 12000);
  }

  // Reads every row in bounded pages (the server caps each response), so a growing database can
  // never be silently truncated or exceed the platform's response-size limit.
  function fetchAllRows() {
    var rows = [];
    function page(offset) {
      return fetch("/api/data?paged=1&offset=" + offset, { headers: { "x-passcode": getStoredPasscode() } })
        .then(function (res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          return res.json();
        })
        .then(function (body) {
          if (Array.isArray(body)) return rows.concat(body); // older server without paging
          rows = rows.concat(body.rows || []);
          if (body.next == null) return rows;
          if (body.next <= offset) throw new Error("bad paging cursor");
          return page(body.next);
        });
    }
    return page(0);
  }

  // Resolves true when the cloud state was loaded, false when it could not be.
  function hydrateFromSupabase() {
    return fetchAllRows().then(function (rows) {
        var origSetItem = window.localStorage.setItem.bind(window.localStorage);
        var groups = {}; // baseKey -> Map(id -> parsedItem)
        var wholeValues = {}; // baseKey -> raw value (non-decomposed rows)
        var staleDraft = false;

        // Store cloud data locally. If the browser refuses (quota), the local copy stays stale, so the
        // diff baseline must be the LOCAL copy: otherwise every cloud record missing locally would be
        // misread as "user deleted this" and wiped from the cloud on the next save.
        function applyLocal(baseKey, value) {
          try { origSetItem(baseKey, value); return true; } catch (e) {
            var localRaw = window.localStorage.getItem(baseKey);
            lastKnownSnapshot[baseKey] = (localRaw && tryDecompose(localRaw)) || new Map();
            return false;
          }
        }

        (rows || []).forEach(function (r) {
          var sep = r.key.indexOf("::");
          var baseKey = sep === -1 ? r.key : r.key.slice(0, sep);
          if (isSystemKey(baseKey)) { if (baseKey === DRAFT_KEY) staleDraft = true; return; }
          if (sep === -1) {
            wholeValues[r.key] = r.value;
          } else {
            var id = r.key.slice(sep + 2);
            if (!groups[baseKey]) groups[baseKey] = new Map();
            try { groups[baseKey].set(id, JSON.parse(r.value)); } catch (e) {}
          }
        });

        // Apply decomposed groups (these take priority over any legacy whole-blob row for the same key)
        Object.keys(groups).forEach(function (baseKey) {
          var items = Array.from(groups[baseKey].values());
          var snapMap = new Map();
          groups[baseKey].forEach(function (item, id) { snapMap.set(id, JSON.stringify(item)); });
          // lastKnownSnapshot always reflects the cloud's current confirmed state (needed for correct future diffing).
          lastKnownSnapshot[baseKey] = snapMap;
          delete legacyRows[baseKey];
          if (!pendingTracker.isPending(baseKey)) {
            applyLocal(baseKey, JSON.stringify(items));
          } else {
            // A key with an unconfirmed pending change must NEVER simply be skipped here (the stale local
            // copy would later be diffed against the advanced snapshot and misread as deletions).
            // MERGE: keep every local record and add whatever the cloud has that is missing locally.
            var localRaw = window.localStorage.getItem(baseKey);
            var localMap = localRaw ? tryDecompose(localRaw) : null;
            var merged = localMap ? new Map(localMap) : new Map();
            groups[baseKey].forEach(function (item, id) {
              if (!merged.has(id)) merged.set(id, JSON.stringify(item));
            });
            var mergedItems = Array.from(merged.values()).map(function (s) {
              try { return JSON.parse(s); } catch (e) { return null; }
            }).filter(function (x) { return x !== null; });
            applyLocal(baseKey, JSON.stringify(mergedItems));
          }
        });

        // Whole-value rows for keys with no decomposed group yet (config objects, or not-yet-migrated arrays)
        Object.keys(wholeValues).forEach(function (baseKey) {
          if (groups[baseKey]) return; // already handled via decomposed group
          var maybeMap = tryDecompose(wholeValues[baseKey]);
          if (maybeMap) {
            // Nothing exists as per-record rows yet, so the baseline is EMPTY: the next save pushes every
            // record (a real migration) and then removes the legacy row. Using the legacy contents as the
            // baseline would push only the edited record and hide all the others on the next load.
            lastKnownSnapshot[baseKey] = new Map();
            legacyRows[baseKey] = true;
          }
          if (!pendingTracker.isPending(baseKey)) {
            applyLocal(baseKey, wholeValues[baseKey]);
          }
        });

        if (staleDraft) {
          // An old build uploaded the shared draft; remove it so it cannot leak into someone else's form.
          fetch("/api/data?key=" + encodeURIComponent(DRAFT_KEY), { method: "DELETE", headers: { "x-passcode": getStoredPasscode() } }).catch(function () {});
        }
        return true;
      }).catch(function () { return false; });
  }

  // Server-side passcode check. Resolves {ok, index} or {ok:false, message}.
  function verifyPasscode(code) {
    return fetch("/api/data?verify=1", { headers: { "x-passcode": code } }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (res.ok) return { ok: true, index: typeof body.index === "number" ? body.index : -1 };
        if (res.status === 401) return { ok: false, message: "Incorrect passcode." };
        return { ok: false, message: body.error || ("Server error (" + res.status + ")") };
      });
    }, function () {
      return { ok: false, message: "Cannot reach the server. Check your internet connection." };
    });
  }

  function showGate() {
    ensureChromeStyles();
    var overlay = document.createElement("div");
    overlay.className = "gm-overlay";
    overlay.innerHTML =
      '<div class="gm-orb"></div>' +
      '<form id="gateForm" class="gm-card">' +
      '<div class="gm-logo">EOD</div>' +
      '<div class="gm-eyebrow">Executive Decision Dashboard</div>' +
      '<div class="gm-title">EOD MONITORING MATRIX</div>' +
      '<div class="gm-subtitle">Enter passcode to continue</div>' +
      '<div class="gm-field">' + LOCK_ICON +
      '<input id="gateInput" type="password" autocomplete="off" class="gm-input" placeholder="Passcode" /></div>' +
      '<div id="gateError" class="gm-error"></div>' +
      '<button type="submit" id="gateSubmitBtn" class="gm-btn"><span>Unlock</span></button>' +
      '<div class="gm-footer">Restricted access &middot; monitored session</div>' +
      '</form>';
    document.body.appendChild(overlay);
    var card = overlay.querySelector(".gm-card");
    var input = document.getElementById("gateInput");
    var errEl = document.getElementById("gateError");
    var btn = document.getElementById("gateSubmitBtn");
    input.focus();
    input.addEventListener("input", function () { errEl.textContent = ""; });

    document.getElementById("gateForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var val = input.value;
      if (!val) { input.focus(); return; }
      errEl.textContent = "";
      btn.disabled = true;
      btn.innerHTML = '<span class="gm-spinner"></span><span>Verifying&hellip;</span>';
      verifyPasscode(val).then(function (r) {
        if (r.ok) {
          sessionStorage.setItem(API_PASSCODE_KEY, val);
          sessionStorage.setItem(USER_IDX_KEY, String(r.index));
          btn.innerHTML = '<span>&#10003;</span><span>Access granted</span>';
          overlay.style.transition = "opacity .35s ease";
          setTimeout(function () {
            overlay.style.opacity = "0";
            setTimeout(function () { overlay.remove(); launchApp(); }, 320);
          }, 180);
        } else {
          errEl.textContent = r.message;
          input.value = "";
          card.classList.remove("gm-shake");
          void card.offsetWidth; // restart animation
          card.classList.add("gm-shake");
          btn.disabled = false;
          btn.innerHTML = "<span>Unlock</span>";
          input.focus();
        }
      });
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    showGate();
  });
})();
