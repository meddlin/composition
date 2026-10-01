import { IMAGE_RESPONSE_HEADERS } from "@/lib/composition/images";
import { readImage } from "@/lib/composition/service";

// Reads from the user's application data directory on every request.
export const dynamic = "force-dynamic";

/**
 * Serves an image pasted into a note, so `![alt](app_data/<name>)` in the
 * preview resolves to `/app_data/<name>`. The desktop build has no routes like
 * this: Electron's main process serves the same URLs (see imageUrl.desktop.ts).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const image = await readImage(name);
  if (!image) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(image.data), {
    headers: { "content-type": image.contentType, ...IMAGE_RESPONSE_HEADERS },
  });
}
