import { describe, expect, it } from "vitest";
import {
  archesFor,
  checksumFile,
  isInside,
  parseArgs,
  parseSigningIdentities,
  tagVersion,
} from "./release-lib.mjs";

// Real output of `security find-identity -p codesigning` with one good identity.
const oneValid = `Policy: Code Signing
  Matching identities
  1) 8FCDC2448C12D893E5AA3C46C361498D55EEEE59 "Developer ID Application: Darrien Rushing (49W52J9ZLN)"
     1 identities found

  Valid identities only
  1) 8FCDC2448C12D893E5AA3C46C361498D55EEEE59 "Developer ID Application: Darrien Rushing (49W52J9ZLN)"
     1 valid identities found
`;

describe("tagVersion", () => {
  it("reads the version out of a desktop release tag", () => {
    expect(tagVersion("desktop-v0.1.0")).toBe("0.1.0");
    expect(tagVersion("desktop-v1.2.3-rc.1")).toBe("1.2.3-rc.1");
  });

  it("rejects anything that isn't a desktop release tag", () => {
    expect(tagVersion("v0.1.0")).toBeNull();
    expect(tagVersion("desktop-v1.2")).toBeNull();
    expect(tagVersion("desktop-vfoo")).toBeNull();
    expect(tagVersion("desktop-v1.2.3;rm -rf /")).toBeNull();
    expect(tagVersion(undefined)).toBeNull();
  });
});

describe("parseArgs", () => {
  it("defaults to a signed build of both architectures", () => {
    expect(parseArgs([])).toEqual({ arch: "both", unsigned: false, check: false, tag: null, help: false });
  });

  it("reads every option, with a space or an equals sign", () => {
    expect(parseArgs(["--arch", "arm64", "--unsigned", "--check", "--tag=desktop-v1.0.0"])).toEqual({
      arch: "arm64",
      unsigned: true,
      check: true,
      tag: "desktop-v1.0.0",
      help: false,
    });
  });

  it("ignores a bare -- that a package manager may pass through", () => {
    expect(parseArgs(["--", "--check"]).check).toBe(true);
  });

  it("refuses unknown options, bad architectures, bad tags and missing values", () => {
    expect(() => parseArgs(["--sign"])).toThrow(/Unknown option/);
    expect(() => parseArgs(["--arch", "ppc"])).toThrow(/arm64, x64 or both/);
    expect(() => parseArgs(["--tag", "v1"])).toThrow(/desktop-v1\.2\.3/);
    expect(() => parseArgs(["--arch"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--arch", "--check"])).toThrow(/needs a value/);
  });
});

describe("archesFor", () => {
  it("expands both", () => {
    expect(archesFor("both")).toEqual(["arm64", "x64"]);
    expect(archesFor("x64")).toEqual(["x64"]);
  });
});

describe("parseSigningIdentities", () => {
  it("finds the valid Developer ID Application identity", () => {
    const { valid, unusable } = parseSigningIdentities(oneValid);

    expect(valid.map((identity) => identity.name)).toEqual(["Developer ID Application: Darrien Rushing (49W52J9ZLN)"]);
    expect(unusable).toEqual([]);
  });

  it("reports an installed identity that isn't valid, as unusable", () => {
    const untrusted = `Policy: Code Signing
  Matching identities
  1) 8FCDC2448C12D893E5AA3C46C361498D55EEEE59 "Developer ID Application: Darrien Rushing (49W52J9ZLN)"
     1 identities found

  Valid identities only
     0 valid identities found
`;
    const { valid, unusable } = parseSigningIdentities(untrusted);

    expect(valid).toEqual([]);
    expect(unusable).toHaveLength(1);
  });

  it("ignores identities that can't sign a Developer ID release", () => {
    const development = `Policy: Code Signing
  Matching identities
  1) AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA "Apple Development: someone@example.com (ABCDE12345)"
     1 identities found

  Valid identities only
  1) AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA "Apple Development: someone@example.com (ABCDE12345)"
     1 valid identities found
`;

    expect(parseSigningIdentities(development)).toEqual({ valid: [], unusable: [] });
  });

  it("finds nothing in an empty keychain", () => {
    expect(parseSigningIdentities("Policy: Code Signing\n     0 identities found\n")).toEqual({
      valid: [],
      unusable: [],
    });
  });
});

describe("isInside", () => {
  it("flags a file inside the repo, and not one outside it", () => {
    expect(isInside("/repo", "/repo/AuthKey.p8")).toBe(true);
    expect(isInside("/repo", "/repo/apps/desktop/AuthKey.p8")).toBe(true);
    expect(isInside("/repo", "/Users/me/.private_keys/AuthKey.p8")).toBe(false);
    expect(isInside("/repo", "/repo-other/AuthKey.p8")).toBe(false);
  });
});

describe("checksumFile", () => {
  it("writes the format `shasum -c` reads", () => {
    expect(checksumFile([{ name: "a.dmg", sha256: "abc" }, { name: "b.zip", sha256: "def" }])).toBe(
      "abc  a.dmg\ndef  b.zip\n",
    );
  });
});
