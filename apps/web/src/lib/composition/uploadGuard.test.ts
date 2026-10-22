import { describe, expect, it } from "vitest";
import { ASSISTANT_HEADER, assistantRefusal, UPLOAD_HEADER, uploadRefusal } from "./uploadGuard";

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

describe("assistantRefusal", () => {
  it("allows the app's own script from the same origin, or a client with no Origin, when it carries its header", () => {
    expect(assistantRefusal(headers({ [ASSISTANT_HEADER]: "1", origin: "http://localhost:3000", host: "localhost:3000" }))).toBeNull();
    expect(assistantRefusal(headers({ [ASSISTANT_HEADER]: "1", host: "localhost:3000" }))).toBeNull();
  });

  it("refuses a request without the header, another site's origin, or an origin that isn't a URL", () => {
    expect(assistantRefusal(headers({ origin: "http://localhost:3000", host: "localhost:3000" }))).not.toBeNull();
    expect(assistantRefusal(headers({ [ASSISTANT_HEADER]: "1", origin: "https://evil.example", host: "localhost:3000" }))).not.toBeNull();
    expect(assistantRefusal(headers({ [ASSISTANT_HEADER]: "1", origin: "null", host: "localhost:3000" }))).not.toBeNull();
  });

  it("does not accept the upload header, nor the upload guard this one", () => {
    expect(assistantRefusal(headers({ [UPLOAD_HEADER]: "1", host: "localhost:3000" }))).not.toBeNull();
    expect(uploadRefusal(headers({ [ASSISTANT_HEADER]: "1", host: "localhost:3000" }))).not.toBeNull();
  });
});
