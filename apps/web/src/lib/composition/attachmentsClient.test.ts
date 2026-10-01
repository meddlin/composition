import { describe, expect, it } from "vitest";
import * as web from "./attachmentsClient";
import * as desktop from "./attachmentsClient.desktop";

describe("attachmentsClient (web build)", () => {
  it("refuses every call, since there is no web backend for attachments", async () => {
    await expect(web.addAttachments(1)).rejects.toThrow(/only available in the desktop app/);
    await expect(web.listAttachments(1)).rejects.toThrow(/only available in the desktop app/);
    await expect(web.removeAttachment(1)).rejects.toThrow(/only available in the desktop app/);
  });

  it("exports the same names as the desktop build", () => {
    expect(Object.keys(web).sort()).toEqual(Object.keys(desktop).sort());
  });
});
