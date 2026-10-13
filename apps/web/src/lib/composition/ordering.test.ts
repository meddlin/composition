import { describe, expect, it } from "vitest";
import { applyOrder, placeBefore } from "./ordering";

describe("placeBefore", () => {
  it("moves an existing sibling before another", () => {
    expect(placeBefore([1, 2, 3, 4], 4, 2)).toEqual([1, 4, 2, 3]);
    expect(placeBefore([1, 2, 3, 4], 1, 3)).toEqual([2, 1, 3, 4]);
  });

  it("moves a sibling to the end when there is nothing to go before", () => {
    expect(placeBefore([1, 2, 3], 1, null)).toEqual([2, 3, 1]);
  });

  it("adds an id that came from another list", () => {
    expect(placeBefore([1, 2], 9, 2)).toEqual([1, 9, 2]);
    expect(placeBefore([1, 2], 9, null)).toEqual([1, 2, 9]);
    expect(placeBefore([], 9, null)).toEqual([9]);
  });

  it("appends when the sibling it was to go before has since gone", () => {
    expect(placeBefore([1, 2], 9, 77)).toEqual([1, 2, 9]);
  });

  it("leaves an id that is dropped before itself where it is", () => {
    expect(placeBefore([1, 2, 3], 2, 2)).toEqual([1, 2, 3]);
  });

  it("does not change the list it was given", () => {
    const ids = [1, 2, 3];
    placeBefore(ids, 3, 1);
    expect(ids).toEqual([1, 2, 3]);
  });
});

describe("applyOrder", () => {
  const item = (id: number) => ({ id });

  it("reorders the named items within the slots they held", () => {
    const items = [item(1), item(2), item(3), item(4), item(5)];
    expect(applyOrder(items, [4, 2, 1]).map((i) => i.id)).toEqual([4, 2, 3, 1, 5]);
  });

  it("is a no-op when the order is unchanged", () => {
    const items = [item(1), item(2), item(3)];
    expect(applyOrder(items, [1, 3]).map((i) => i.id)).toEqual([1, 2, 3]);
  });
});
