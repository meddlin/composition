import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { findLatestRelease, pickRelease, STABLE_FEED_URL } from "./releaseFeed";

const release = (tag: string, assets: string[], extra: object = {}) => ({
  tag_name: tag,
  assets: assets.map((name) => ({ name })),
  ...extra,
});

describe("pickRelease", () => {
  it("takes the newest desktop release, pre-release or not, and reads its update file from that release", () => {
    expect(
      pickRelease([
        release("desktop-v0.2.0", ["Composition-0.2.0-arm64.zip", "latest-mac.yml"], { prerelease: true }),
        release("desktop-v0.1.4", ["latest-mac.yml"]),
      ], "darwin"),
    ).toEqual({
      url: "https://github.com/meddlin/composition/releases/download/desktop-v0.2.0",
      channel: "latest",
    });
  });

  it("uses the channel named by the update file, which is how a beta version is published", () => {
    expect(pickRelease([release("desktop-v0.3.0-beta.1", ["beta-mac.yml", "x.zip"])], "darwin")).toMatchObject({ channel: "beta" });
  });

  it("skips drafts, other products' releases and releases without a macOS update file", () => {
    expect(
      pickRelease([
        release("desktop-v0.4.0", ["latest-mac.yml"], { draft: true }),
        release("cli-v1.0.0", ["latest-mac.yml"]),
        release("desktop-v0.3.0", ["Composition-0.3.0.dmg"]),
        release("desktop-v0.2.0", ["latest-mac.yml"]),
      ], "darwin"),
    ).toMatchObject({ url: expect.stringContaining("desktop-v0.2.0") });
  });

  it("reads latest-linux.yml on Linux, from the release that has it, and ignores the macOS file", () => {
    const releases = [
      release("desktop-v0.7.0", ["Composition-0.7.0-arm64.dmg", "latest-mac.yml"]),
      release("desktop-v0.6.2", ["Composition-0.6.2-x64.AppImage", "latest-linux.yml", "latest-mac.yml"]),
    ];

    expect(pickRelease(releases, "linux")).toEqual({
      url: "https://github.com/meddlin/composition/releases/download/desktop-v0.6.2",
      channel: "latest",
    });
    expect(pickRelease(releases, "darwin")).toMatchObject({ url: expect.stringContaining("desktop-v0.7.0") });
    expect(pickRelease([release("desktop-v0.6.2", ["beta-linux.yml"])], "linux")).toMatchObject({ channel: "beta" });
  });

  it("finds nothing on a platform the app doesn't update on, or for Linux ARM's differently named file", () => {
    expect(pickRelease([release("desktop-v0.6.2", ["latest-mac.yml", "latest-linux.yml"])], "win32")).toBeNull();
    expect(pickRelease([release("desktop-v0.6.2", ["latest-linux-arm64.yml"])], "linux")).toBeNull();
  });

  it.each([[null], [{}], [[]], [[{ tag_name: 5 }]], [[null]], [[release("desktop-v1.0.0", [])]]])(
    "finds nothing in %j",
    (releases) => {
      expect(pickRelease(releases, "darwin")).toBeNull();
    },
  );
});

describe("findLatestRelease", () => {
  it("lists releases from the GitHub API", async () => {
    const fetchJson = vi.fn(async () => Response.json([release("desktop-v0.1.4", ["latest-mac.yml"])]));
    expect(await findLatestRelease(fetchJson as unknown as typeof fetch, "darwin")).toMatchObject({ channel: "latest" });
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/api\.github\.com\/repos\/meddlin\/composition\/releases/),
      expect.anything(),
    );
  });

  it("fails, with the status, when GitHub refuses", async () => {
    const fetchJson = vi.fn(async () => new Response("rate limited", { status: 403 }));
    await expect(findLatestRelease(fetchJson as unknown as typeof fetch)).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("STABLE_FEED_URL", () => {
  it("is the feed the build bakes into the app", () => {
    const config = fs.readFileSync(path.join(__dirname, "../../electron-builder.yml"), "utf-8");
    expect(config).toMatch(new RegExp(`^\\s+url: ${STABLE_FEED_URL}\\s*$`, "m"));
  });
});
