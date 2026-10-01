import { MAX_IMAGE_BYTES } from "./imageRefs";

/**
 * Largest image the editor will try to save, or null for no limit. The web
 * build caps it; a desktop build resolves `imageLimit.desktop.ts` instead
 * (next.config.ts), because the images never leave the user's own machine.
 */
export const maxImageBytes: number | null = MAX_IMAGE_BYTES;
