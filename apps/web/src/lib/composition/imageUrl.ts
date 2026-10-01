import { IMAGE_DIR_NAME } from "./imageRefs";

/**
 * Where the browser fetches a stored image from. In the web build that is the
 * `/app_data/[name]` route; a desktop build resolves `imageUrl.desktop.ts`
 * instead (next.config.ts).
 */
export function imageUrl(name: string): string {
  return `/${IMAGE_DIR_NAME}/${name}`;
}
