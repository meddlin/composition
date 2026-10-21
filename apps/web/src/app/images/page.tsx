import { listImages } from "@/lib/composition/service";
import { ImagesScreen } from "./ImagesScreen";

// Reads live local disk state and can't safely run in a build-time worker
// thread (see the note in app/page.tsx) — always render at request time.
export const dynamic = "force-dynamic";

export default async function ImagesPage() {
  return <ImagesScreen images={await listImages()} />;
}
