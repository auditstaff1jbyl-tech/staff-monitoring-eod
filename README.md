# EOD Monitoring Matrix

Operational audit, real-time variance monitoring, branch risk analysis, and action tracking.

## Project structure

```
.
├── api/
│   └── data.js               Serverless proxy to Supabase (Vercel function). Unchanged —
│                              already well-structured: passcode auth, key validation,
│                              pagination, no secrets shipped to the browser.
├── assets/
│   ├── favicon.png            App icon (previously a base64 data URI inline in index.html)
│   ├── css/
│   │   └── styles.css         Compiled Tailwind styles (previously inlined in a <style> tag)
│   └── js/
│       ├── config.js          USER_DIRECTORY — display names for the presence widget.
│       │                      No secrets; passcodes are verified server-side only.
│       ├── app-bootstrap.js   Passcode gate, Supabase hydrate/sync, presence widget,
│       │                      sync status badge. Dynamically imports app.bundle.js only
│       │                      after the gate passes and initial data has loaded.
│       ├── display-settings.js  Brightness / eye-comfort widget. Independent of the
│       │                        main app; works even on the passcode screen.
│       └── app.bundle.js      The compiled application (previously embedded as a
│                              `<script type="text/plain">` blob and copy-pasted into a
│                              new <script> tag at runtime — now a normal file, loaded
│                              with a real `import()`).
├── index.html                 Slim HTML shell: links the assets above in the required
│                              load order (config → bootstrap → display-settings).
├── vercel.json                Routing/caching headers.
└── package.json
```

## What changed vs. the previous single-file version

The app previously shipped as one **2.3 MB, ~49,600-line `index.html`** file with the
entire compiled app, all CSS, and the favicon inlined directly in the markup. That has
been split into the files above. **No application behavior was changed** — this was a
structural extraction only:

- The compiled bundle, CSS, and favicon were extracted byte-for-byte into their own files.
- The one intentional code change: `app-bootstrap.js`'s `startApp()` now loads the bundle
  with a standard `import("/assets/js/app.bundle.js")` instead of copying a
  `<script type="text/plain">` blob's `textContent` into a freshly created `<script>` tag.
  This preserves the original "only load the app after the passcode gate passes and data
  has hydrated" timing, while giving the bundle a real, cacheable, DevTools-debuggable file.
- `api/data.js` was not touched.

## Known limitation / next step

`assets/js/app.bundle.js` is still a **pre-minified build artifact** (variable names like
`oQ`, checked into source control as the "source"). Splitting files fixed the project
*structure*, but true componentization (readable source, reusable UI components, a real
build step) would require either the original unminified source (if it still exists
anywhere) or a scoped rewrite of the UI in a framework like React/Vite. Happy to help with
either as a next phase.

## Role-based limited accounts (added)

There is no per-user login system — access is still by shared passcode — but each
passcode *slot* (its position in the comma-separated `APP_PASSCODES` env var) can now
be tagged with a `role` in `assets/js/config.js`, which controls which sidebar tabs
that passcode's user sees.

- `USER_DIRECTORY[i].role` — `"full"` (or omitted) sees every tab, unchanged.
  `"limited"` only sees the tabs listed for it in `ROLE_TAB_ACCESS`.
- `ROLE_TAB_ACCESS` — maps a role name to the array of allowed tab ids. Tab ids are:
  `overview`, `daily`, `monthly`, `tracker`, `staff`, `records`, `settings`.
- A new **3rd passcode slot** (`limitedviewer`, role `limited`, allowed:
  `overview`, `monthly`, `tracker`) was added. To activate it, add a 3rd comma-separated
  value to the Vercel `APP_PASSCODES` env var (order matters — it must be the 3rd value
  to match index 2 in `USER_DIRECTORY`):
  ```
  APP_PASSCODES=existingcode1,existingcode2,yourNewLimitedPasscode
  ```

**How it works:** the server (`api/data.js`) already returns which passcode *slot*
matched (`index`) on `verify=1`. The client stores that index, looks up the matching
`USER_DIRECTORY` entry (and its `role`) in `app-bootstrap.js`, and — right when the app
launches — injects a small `<style>` block that hides the sidebar buttons for any tab
id not in that role's allowed list (the bundle already renders each tab button with a
predictable id, `nav-tab-<tabId>`, so plain CSS `display:none` is enough; no bundle
edits needed).

**Important limitation:** this hides tabs in the UI only. It does **not** stop the
`limited` passcode from calling `/api/data` directly (e.g. via DevTools) to read or
write records belonging to hidden features — `api/data.js` still authorizes by
passcode only, not by role. Treat this as a UX/UI restriction for normal use, not a
security boundary. If the limited account must be *hard-blocked* from touching
data outside its allowed tabs (recommended for anything audit/disciplinary-related),
the next step is to also check `role` server-side in `api/data.js` (e.g. reject
POST/DELETE on `eod_matrix_*` keys tied to staff/disciplinary/settings data when the
matched passcode's role is `limited`). Happy to add that hardening pass on request.

## Local development

```bash
npm i -g vercel   # once
vercel dev
```

Requires `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, and `APP_PASSCODES` set as environment
variables (see `api/data.js`).
