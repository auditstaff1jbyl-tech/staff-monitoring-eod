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

## Local development

```bash
npm i -g vercel   # once
vercel dev
```

Requires `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, and `APP_PASSCODES` set as environment
variables (see `api/data.js`).
