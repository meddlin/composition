import { IMAGE_DIR_NAME } from "./imageRefs";

/**
 * Desktop build's replacement for `imageUrl.ts`: Electron's main process
 * serves stored images at `app://composition/app_data/<name>`
 * (apps/desktop/src/main/protocol.ts). The origin is spelled out rather than
 * relative so images also load when the UI itself comes from `next dev`.
 */
export function imageUrl(name: string): string {
  return `app://composition/${IMAGE_DIR_NAME}/${name}`;
}
