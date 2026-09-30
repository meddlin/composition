import { loadSettings } from "@/lib/composition/service";
import { SettingsScreen } from "./SettingsScreen";

// Reads live local disk state and can't safely run in a build-time worker
// thread (see the note in app/page.tsx) — always render at request time.
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  return <SettingsScreen snapshot={await loadSettings()} />;
}
