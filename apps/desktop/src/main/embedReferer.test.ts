import { describe, expect, it, vi } from "vitest";
import { EMBED_REFERER, EMBED_URL_PATTERN, installEmbedReferer, type WebRequestHooks } from "./embedReferer";

describe("installEmbedReferer", () => {
  it("sets the referrer on the player's requests only, keeping the other headers", () => {
    const onBeforeSendHeaders = vi.fn<WebRequestHooks["onBeforeSendHeaders"]>();
    installEmbedReferer({ onBeforeSendHeaders });

    const [filter, listener] = onBeforeSendHeaders.mock.calls[0];
    expect(filter).toEqual({ urls: [EMBED_URL_PATTERN] });
    expect(EMBED_URL_PATTERN).toBe("https://www.youtube-nocookie.com/embed/*");

    const callback = vi.fn();
    listener({ requestHeaders: { "User-Agent": "x", Referer: "" } }, callback);
    expect(callback).toHaveBeenCalledWith({ requestHeaders: { "User-Agent": "x", Referer: EMBED_REFERER } });
  });

  it("uses an address that is http(s), which is all the player checks", () => {
    expect(new URL(EMBED_REFERER).protocol).toBe("https:");
  });
});
