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

  // Shown when the cloud could not be reached on a device that has never stored any data.
  // Starting the app here would display the built-in SAMPLE records and the first save would
  // upload them into the real database, so we refuse to start and offer a retry instead.
  function showLoadFailure() {
    var overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:#1B1918;display:flex;align-items:center;justify-content:center;z-index:100001;font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:20px;";
    overlay.innerHTML =
      '<div style="background:#FAF7F2;padding:32px;border-radius:16px;width:360px;max-width:92vw;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.5);">' +
      '<div style="font-weight:800;font-size:16px;color:#2C2A29;margin-bottom:8px;">Could not load your data</div>' +
      '<div style="font-size:13px;color:#6C655B;margin-bottom:18px;line-height:1.5;">The cloud database did not respond. To protect your records the app will not start with an empty local copy. Check your internet connection and try again.</div>' +
      '<button id="retryLoadBtn" style="width:100%;padding:10px;background:#1B1918;color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer;">Retry</button></div>';
    document.body.appendChild(overlay);
    overlay.querySelector("#retryLoadBtn").addEventListener("click", function () {
      overlay.remove();
      loadThenStart();
    });
  }

  function showOfflineNotice() {
    var el = document.createElement("div");
    el.style.cssText = "position:fixed;left:14px;bottom:16px;z-index:99999;max-width:340px;background:#FFF4DC;color:#8A6A1F;font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:12px;font-weight:600;line-height:1.4;padding:10px 14px;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,.15);";
    el.textContent = "\u26A0 Could not reach the cloud. Showing the last data saved on this device. Reload once you are back online to get the latest records.";
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 12000);
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
    loadThenStart();
  }

  var currentUser = null; // {slug, name}
  function resolveCurrentUser() {
    var idx = parseInt(sessionStorage.getItem(USER_IDX_KEY), 10);
    return isNaN(idx) ? null : (USER_DIRECTORY[idx] || null);
  }

  function buildPresenceWidget() {
    currentUser = resolveCurrentUser();
    var bar = document.createElement("div");
    bar.style.cssText = "position:fixed;top:80px;right:14px;z-index:99999;display:flex;gap:8px;font-family:-apple-system,Segoe UI,Roboto,sans-serif;";
    document.body.appendChild(bar);

    var pillEls = {};
    USER_DIRECTORY.forEach(function (u) {
      var pill = document.createElement("div");
      pill.style.cssText = "display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:20px;background:#FAF7F2;box-shadow:0 4px 12px rgba(0,0,0,.15);font-size:11.5px;font-weight:600;color:#2C2A29;border:1px solid #EAE3D5;";
      var dot = document.createElement("span");
      dot.style.cssText = "width:8px;height:8px;border-radius:50%;background:#C9C2B4;display:inline-block;transition:background .3s;";
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
    syncBadgeEl = document.createElement("div");
    syncBadgeEl.style.cssText = "position:fixed;top:124px;right:14px;z-index:99999;font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:11.5px;font-weight:600;padding:6px 12px;border-radius:20px;box-shadow:0 4px 12px rgba(0,0,0,.2);display:none;align-items:center;gap:6px;transition:opacity .3s;";
    document.body.appendChild(syncBadgeEl);
  }
  function setSyncStatus(status) {
    if (!syncBadgeEl) return;
    clearTimeout(syncBadgeHideTimer);
    syncBadgeEl.style.display = "flex";
    syncBadgeEl.style.opacity = "1";
    if (status === "pending" || status === "saving") {
      syncBadgeEl.style.background = "#FFF4DC";
      syncBadgeEl.style.color = "#8A6A1F";
      syncBadgeEl.textContent = status === "saving" ? "⏳ Saving to cloud..." : "● Unsaved changes";
    } else if (status === "saved") {
      syncBadgeEl.style.background = "#E4F5EA";
      syncBadgeEl.style.color = "#1C7A42";
      syncBadgeEl.textContent = "✓ Saved to cloud";
      syncBadgeHideTimer = setTimeout(function () {
        syncBadgeEl.style.opacity = "0";
        setTimeout(function () { syncBadgeEl.style.display = "none"; }, 300);
      }, 2200);
    } else if (status === "error") {
      syncBadgeEl.style.background = "#FCE4E4";
      syncBadgeEl.style.color = "#B53D43";
      syncBadgeEl.textContent = "⚠ Not saved — check connection";
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
    var overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:#1B1918;display:flex;align-items:center;justify-content:center;z-index:9999;font-family:-apple-system,Segoe UI,Roboto,sans-serif;";
    overlay.innerHTML =
      '<form id="gateForm" style="background:#FAF7F2;padding:40px;border-radius:16px;width:320px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,.5);text-align:center;">' +
      '<div style="font-weight:800;font-size:18px;letter-spacing:.05em;color:#2C2A29;margin-bottom:4px;">EOD MONITORING MATRIX</div>' +
      '<div style="font-size:12px;color:#6C655B;margin-bottom:20px;">Enter passcode to continue</div>' +
      '<input id="gateInput" type="password" autocomplete="off" style="width:100%;padding:10px 12px;border:1px solid #EAE3D5;border-radius:8px;font-size:15px;outline:none;box-sizing:border-box;" placeholder="Passcode" />' +
      '<div id="gateError" style="color:#B53D43;font-size:12px;height:16px;margin-top:8px;"></div>' +
      '<button type="submit" style="margin-top:8px;width:100%;padding:10px;background:#1B1918;color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer;">Unlock</button>' +
      '</form>';
    document.body.appendChild(overlay);
    document.getElementById("gateInput").focus();
    document.getElementById("gateForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var val = document.getElementById("gateInput").value;
      document.getElementById("gateError").textContent = "";
      verifyPasscode(val).then(function (r) {
        if (r.ok) {
          sessionStorage.setItem(API_PASSCODE_KEY, val);
          sessionStorage.setItem(USER_IDX_KEY, String(r.index));
          overlay.remove();
          launchApp();
        } else {
          document.getElementById("gateError").textContent = r.message;
          document.getElementById("gateInput").value = "";
          document.getElementById("gateInput").focus();
        }
      });
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    showGate();
  });
})();
