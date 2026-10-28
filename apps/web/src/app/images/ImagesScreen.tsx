import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { RouteBackNav } from "@/components/RouteBackNav";
import { Button } from "@/components/ui/button";
import type { ImageInfo } from "@/lib/composition/api";
import { ImageLibrary } from "./ImageLibrary";

/**
 * The Images screen, rendered from a listing. The web page builds the listing
 * on the server; the desktop page loads it over IPC.
 */
export function ImagesScreen({ images }: { images: ImageInfo[] }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 p-6">
      <RouteBackNav />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Images</h1>
          <p className="text-muted-foreground">
            Every image pasted into a note, including ones no note uses any more. In the editor,{" "}
            <kbd className="rounded border bg-muted px-1 font-mono text-xs">Cmd/Ctrl+Shift+M</kbd> inserts one.
          </p>
        </div>
        <Button asChild variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
          <Link href="/">
            <ArrowLeftIcon /> Back to notes
          </Link>
        </Button>
      </div>

      <ImageLibrary images={images} />
    </div>
  );
}
