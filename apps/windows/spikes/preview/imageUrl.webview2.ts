import { IMAGE_DIR_NAME } from "@/lib/composition/imageRefs";

/**
 * The WebView2 host's replacement for imageUrl.ts: the native shell maps the data folder to a virtual host
 * (CoreWebView2.SetVirtualHostNameToFolderMapping("composition.local", <data folder>, DenyCors)), so a stored image is a plain
 * https URL to a local file and the page needs no bridge to show it.
 */
export function imageUrl(name: string): string {
  return `https://composition.local/${IMAGE_DIR_NAME}/${name}`;
}
