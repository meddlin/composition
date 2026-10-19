import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { MAX_ATTACHMENT_BYTES, formatBytes } from "@/lib/composition/attachmentNames";
import { addAttachmentStream } from "@/lib/composition/service";
import { uploadRefusal } from "@/lib/composition/uploadGuard";

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => Response.json(body, { status });

/**
 * Attaches the file in the request body to the note: `POST ?name=<file name>`,
 * the raw bytes as the body, one file per request. The body is streamed to disk
 * (up to 1 GB, so never buffered), which is why this is a route handler and not
 * a Server Action, whose bodies are capped and held in memory. Answers
 * `{ attachments, error? }`, the shape the desktop app's picker returns.
 *
 * The desktop build has no routes like this: its main process opens a native
 * file picker and copies the chosen paths (see main/attachments.ts).
 */
export async function POST(request: Request, { params }: { params: Promise<{ noteId: string }> }) {
  const refusal = uploadRefusal(request.headers);
  if (refusal) return json({ attachments: [], error: refusal }, 403);

  const { noteId: rawId } = await params;
  const noteId = Number(rawId);
  const name = new URL(request.url).searchParams.get("name");
  if (!Number.isInteger(noteId) || !name || !request.body) {
    return json({ attachments: [], error: "Send a file name and the file's bytes." }, 400);
  }

  const declared = Number(request.headers.get("content-length"));
  if (declared > MAX_ATTACHMENT_BYTES) {
    return json(
      { attachments: [], error: `${name}: files can be at most ${formatBytes(MAX_ATTACHMENT_BYTES)}.` },
      413,
    );
  }

  const result = await addAttachmentStream(noteId, name, Readable.fromWeb(request.body as NodeReadableStream));
  return json(result, result.error ? 422 : 200);
}
