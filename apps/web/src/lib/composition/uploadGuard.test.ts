import { describe, expect, it } from "vitest";
import { UPLOAD_HEADER, uploadRefusal } from "./uploadGuard";

const headers = (init: Record<string, string>) => new Headers(init);

describe("uploadRefusal", () => {
  it("allows our own script's upload from the same origin", () => {
    expect(uploadRefusal(headers({ [UPLOAD_HEADER]: "1", origin: "http://localhost:3000", host: "localhost:3000" }))).toBeNull();
  });

  it("allows a request with no Origin, such as curl, when it carries the header", () => {
    expect(uploadRefusal(headers({ [UPLOAD_HEADER]: "1", host: "localhost:3000" }))).toBeNull();
  });

  it("refuses a request without the header, which is all a cross-site form or simple fetch can send", () => {
    expect(uploadRefusal(headers({ origin: "http://localhost:3000", host: "localhost:3000" }))).not.toBeNull();
  });

  it("refuses another site's origin even with the header", () => {
    expect(uploadRefusal(headers({ [UPLOAD_HEADER]: "1", origin: "https://evil.example", host: "localhost:3000" }))).not.toBeNull();
  });

  it("refuses an Origin that isn't a URL", () => {
    expect(uploadRefusal(headers({ [UPLOAD_HEADER]: "1", origin: "null", host: "localhost:3000" }))).not.toBeNull();
  });
});
