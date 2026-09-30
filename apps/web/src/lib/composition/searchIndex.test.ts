import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe("search configuration", () => {
  it("defaults to the MEILI_URL environment variable, then localhost:7700", async () => {
    const searchIndex = await import("./searchIndex");
    expect(searchIndex.meiliHost()).toBe("http://127.0.0.1:7700");

    vi.stubEnv("MEILI_URL", "http://10.0.0.5:7701");
    expect(searchIndex.meiliHost()).toBe("http://10.0.0.5:7701");
  });

  it("prefers an explicit configuration over the environment", async () => {
    vi.stubEnv("MEILI_URL", "http://10.0.0.5:7701");
    const searchIndex = await import("./searchIndex");

    searchIndex.configureSearch({ host: "http://127.0.0.1:43111", apiKey: "k" });

    expect(searchIndex.meiliHost()).toBe("http://127.0.0.1:43111");
  });

  it("explains why search is unavailable, and rejects queries, until it is configured again", async () => {
    const searchIndex = await import("./searchIndex");

    searchIndex.disableSearch("The bundled search engine failed to start.");

    expect(searchIndex.unavailableMessage()).toBe("The bundled search engine failed to start.");
    await expect(searchIndex.searchNoteIds("hello")).rejects.toThrow("failed to start");

    searchIndex.configureSearch({ host: "http://127.0.0.1:43111" });
    expect(searchIndex.unavailableMessage()).toMatch(/Is Meilisearch running at http:\/\/127\.0\.0\.1:43111\?/);
  });

  it("still returns no hits for an empty query without contacting anything", async () => {
    const searchIndex = await import("./searchIndex");
    searchIndex.disableSearch("unavailable");

    await expect(searchIndex.searchNoteIds("   ")).resolves.toEqual([]);
  });
});
