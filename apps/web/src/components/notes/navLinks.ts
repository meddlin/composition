/**
 * Links at the bottom of the navigator. The desktop build resolves
 * `navLinks.desktop.ts` instead, which leaves out the repo-docs viewer.
 */
export const NAV_LINKS = [
  { href: "/docs", label: "Docs" },
  { href: "/settings", label: "Settings" },
] as const;
