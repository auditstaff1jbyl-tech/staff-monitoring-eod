// User directory config — maps passcode slot index (0-based, matching the
// APP_PASSCODES order in Vercel env vars) to a display name shown in the
// presence widget. No secrets here — passcodes are verified server-side only.
// Database credentials now live server-side only (Vercel env vars),
// accessed via the secure /api/data proxy. Nothing sensitive here.
// No secrets live in this file. The passcode is verified by the server (/api/data?verify=1),
// which also reports which passcode slot matched (0-based, in the same order as the
// APP_PASSCODES Vercel variable). That slot picks the matching entry below for the presence pills.
var USER_DIRECTORY = [
  { slug: "auditstaff1", name: "Audit Staff 1" },
  { slug: "auditstaff2", name: "Audit Staff 2" }
];
