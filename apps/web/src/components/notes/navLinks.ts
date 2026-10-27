import { BookTextIcon, ImageIcon, SettingsIcon } from "lucide-react";

/**
 * Links at the bottom of the notebook panel. The desktop build resolves
 * `navLinks.desktop.ts` instead, which leaves out the repo-docs viewer.
 */
export const NAV_LINKS = [
  { href: "/docs", label: "Docs", icon: BookTextIcon },
  { href: "/images", label: "Images", icon: ImageIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
] as const;
