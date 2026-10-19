import fs from "node:fs";
import { Readable } from "node:stream";
import { attachmentDisposition } from "@/lib/composition/attachmentNames";
import { findAttachmentFile } from "@/lib/composition/service";

export const dynamic = "force-dynamic";

/**
 * Sends an attachment's bytes as a download, so the browser saves it. The web
 * app's counterpart of the desktop's "Save a copy…". Always a download, never
 * displayed: `application/octet-stream` plus `attachment` plus `nosniff`, so an
 * attached `.html` or `.svg` can't run script on this origin, the same stance
 * as the desktop app's refusal to "open" an attachment.
 *
 * The file is found from the row's id, never from a name the client sent.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  const found = Number.isInteger(id) ? await findAttachmentFile(id) : null;
  if (!found) return new Response("Not found", { status: 404 });

  let size: number;
  try {
    size = (await fs.promises.stat(found.path)).size;
  } catch {
    return new Response("Not found", { status: 404 });
  }
  return new Response(Readable.toWeb(fs.createReadStream(found.path)) as ReadableStream<Uint8Array>, {
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(size),
      "content-disposition": attachmentDisposition(found.fileName),
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
