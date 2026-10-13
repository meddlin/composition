import { describe, expect, it } from "vitest";
import { dropEdge } from "./dropEdge";

describe("dropEdge", () => {
  it("gives a row that can be dropped onto its middle, and outer bands to the edges", () => {
    const all = ["before", "into", "after"] as const;
    expect(dropEdge(2, 40, all)).toBe("before");
    expect(dropEdge(20, 40, all)).toBe("into");
    expect(dropEdge(38, 40, all)).toBe("after");
  });

  it("folds a band into the middle when that edge is not allowed", () => {
    expect(dropEdge(2, 40, ["into", "after"])).toBe("into");
    expect(dropEdge(38, 40, ["before", "into"])).toBe("into");
  });

  it("splits a row that can only be placed beside down the middle", () => {
    expect(dropEdge(5, 30, ["before", "after"])).toBe("before");
    expect(dropEdge(25, 30, ["before", "after"])).toBe("after");
  });

  it("uses the one edge on offer wherever the pointer is", () => {
    expect(dropEdge(25, 30, ["before"])).toBe("before");
    expect(dropEdge(5, 30, ["after"])).toBe("after");
  });

  it("is null when nothing is allowed, and treats a zero-height row as its middle", () => {
    expect(dropEdge(5, 30, [])).toBeNull();
    expect(dropEdge(0, 0, ["before", "into", "after"])).toBe("into");
  });
});
