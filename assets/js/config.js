// User directory config — maps passcode slot index (0-based, matching the
// APP_PASSCODES order in Vercel env vars) to a display name shown in the
// presence widget. No secrets here — passcodes are verified server-side only.
// Database credentials now live server-side only (Vercel env vars),
// accessed via the secure /api/data proxy. Nothing sensitive here.
// No secrets live in this file. The passcode is verified by the server (/api/data?verify=1),
// which also reports which passcode slot matched (0-based, in the same order as the
// APP_PASSCODES Vercel variable). That slot picks the matching entry below for the presence pills.
// "role" controls which sidebar tabs a user sees (see ROLE_TAB_ACCESS below).
// role omitted or "full" => sees everything (unchanged behavior for existing staff).
var USER_DIRECTORY = [
  { slug: "auditstaff1", name: "Audit Staff 1", role: "full" },
  { slug: "auditstaff2", name: "Audit Staff 2", role: "full" },
  // New limited-access account. Its passcode must be added as the 3RD value
  // (index 2) in the Vercel APP_PASSCODES env var, e.g.:
  //   APP_PASSCODES = existingcode1,existingcode2,yourNewPasscodeHere
  { slug: "limitedviewer", name: "Limited Viewer", role: "limited" }
];

// Sidebar tab ids (from the app bundle's nav config) that each role is allowed to see.
// Tabs not listed here are hidden (via CSS) for that role. Full/unlisted roles see all tabs.
var ROLE_TAB_ACCESS = {
  limited: ["overview", "monthly", "tracker"]
  // full role (or any role not listed here) => no restriction, all tabs shown
};
