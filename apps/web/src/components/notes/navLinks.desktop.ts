import { ImageIcon, SettingsIcon } from "lucide-react";

/**
 * Desktop build: no Docs viewer. It renders this repository's developer docs
 * from disk, which don't exist inside an installed app (docs/desktop-app-plan.md, D9).
 */
export const NAV_LINKS = [
  { href: "/images", label: "Images", icon: ImageIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
] as const;
