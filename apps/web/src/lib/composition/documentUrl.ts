/**
 * Where the reader fetches a PDF's bytes: the main process serves them at `app://composition/documents/<id>`, with byte
 * ranges (apps/desktop/src/main/rangeResponse.ts). The origin is spelled out rather than relative so the bytes also load
 * when the UI itself comes from `next dev`, like a pasted image (imageUrl.desktop.ts). Desktop only.
 */
export function documentUrl(documentId: number): string {
  return `app://composition/documents/${documentId}`;
}
