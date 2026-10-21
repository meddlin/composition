/**
 * Desktop build: no Docs viewer. It renders this repository's developer docs
 * from disk, which don't exist inside an installed app (docs/desktop-app-plan.md, D9).
 */
export const NAV_LINKS = [
  { href: "/images", label: "Images" },
  { href: "/settings", label: "Settings" },
] as const;
