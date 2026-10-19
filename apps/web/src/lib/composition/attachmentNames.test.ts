import { describe, expect, it } from "vitest";
import { attachmentDisposition, displayName, formatBytes, storedFileName } from "./attachmentNames";

describe("storedFileName", () => {
  it("keeps the extension and prefixes a unique part", () => {
    expect(storedFileName("3f9c2a71b0de", "Quarterly report.pdf")).toBe("3f9c2a71b0de-Quarterly_report.pdf");
  });

  it("drops any directory the name came with", () => {
    expect(storedFileName("a", "../../etc/passwd")).toBe("a-passwd");
    expect(storedFileName("a", "C:\\Users\\me\\notes.txt")).toBe("a-notes.txt");
  });

  it("never produces a hidden file or a path separator", () => {
    const name = storedFileName("a", ".env");
    expect(name).toBe("a-env");
    expect(storedFileName("a", "..hidden.txt")).toBe("a-hidden.txt");
    expect(storedFileName("a", "a/b\\c")).not.toMatch(/[\\/]/);
  });

  it("handles names with no extension, no usable characters, or lots of characters", () => {
    expect(storedFileName("a", "Makefile")).toBe("a-Makefile");
    expect(storedFileName("a", "日本語.txt")).toBe("a-file.txt");
    expect(storedFileName("a", "")).toBe("a-file");
    const long = storedFileName("a", `${"x".repeat(300)}.tar.gz`);
    expect(long).toBe(`a-${"x".repeat(100)}.gz`);
  });
});

describe("displayName", () => {
  it("is the last path segment", () => {
    expect(displayName("/Users/me/Documents/report.pdf")).toBe("report.pdf");
    expect(displayName("C:\\docs\\report.pdf")).toBe("report.pdf");
    expect(displayName("")).toBe("file");
  });
});

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [812, "812 B"],
    [1000, "1 KB"],
    [1500, "1.5 KB"],
    [1_400_000, "1.4 MB"],
    [250_000_000, "250 MB"],
    [100 * 1024 * 1024, "105 MB"],
    [3_200_000_000, "3.2 GB"],
  ])("%d bytes is %s", (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });
});

describe("attachmentDisposition", () => {
  it("is always a download, with the name quoted", () => {
    expect(attachmentDisposition("report.pdf")).toBe(`attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`);
  });

  it("keeps a non-ASCII name in filename* and a safe stand-in in filename", () => {
    const value = attachmentDisposition("café menu (1).pdf");
    expect(value).toContain(`filename="caf_ menu (1).pdf"`);
    expect(value).toContain(`filename*=UTF-8''caf%C3%A9%20menu%20%281%29.pdf`);
  });

  it("can't be broken out of by quotes, semicolons, path separators or newlines", () => {
    const value = attachmentDisposition('a"; filename=evil.html\r\nX: y/../b.txt');
    expect(value.startsWith("attachment; filename=")).toBe(true);
    expect(value).not.toMatch(/[\r\n]/);
    expect(value.match(/filename=/g)).toHaveLength(1);
    expect(value).toContain("b.txt");
  });
});
