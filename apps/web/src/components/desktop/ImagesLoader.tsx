"use client";

import { ImagesScreen } from "@/app/images/ImagesScreen";
import { listImages } from "@/lib/composition/client";
import { LoadFailed } from "./LoadFailed";
import { useLoaded } from "./useLoaded";

/** Desktop images: load the listing over IPC, then render the web's ImagesScreen. */
export function ImagesLoader() {
  const images = useLoaded(listImages);

  if (images.status === "error") {
    return <LoadFailed what="your images" message={images.message} />;
  }
  if (images.status === "loading") {
    return <div aria-busy="true" className="min-h-screen" />;
  }
  return <ImagesScreen images={images.value} />;
}
