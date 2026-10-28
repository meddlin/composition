import { PopoutApp } from "@/components/desktop/PopoutApp";

// A pop-out: a panel pulled into a window of its own. Desktop only (it has no `page.tsx`, so the web build has no such route).
export default function PopoutPage() {
  return <PopoutApp />;
}
