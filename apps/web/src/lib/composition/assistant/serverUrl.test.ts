import { describe, expect, it } from "vitest";
import { DEFAULT_SERVER_URL, isLoopback, parseServerUrl } from "./serverUrl";

const ok = (input: string) => {
  const result = parseServerUrl(input);
  if (!result.ok) throw new Error(`expected ${JSON.stringify(input)} to be accepted, got: ${result.error}`);
  return result.url;
};

const refused = (input: string) => {
  const result = parseServerUrl(input);
  if (result.ok) throw new Error(`expected ${JSON.stringify(input)} to be refused, got: ${result.url}`);
  return result.error;
};

describe("parseServerUrl", () => {
  it("uses Ollama's own address when nothing is entered", () => {
    expect(DEFAULT_SERVER_URL).toBe("http://127.0.0.1:11434");
    expect(ok("")).toBe("http://127.0.0.1:11434");
    expect(ok("   ")).toBe("http://127.0.0.1:11434");
  });

  it("drops a trailing slash and lowercases the host", () => {
    expect(ok("http://192.168.1.5:11434/")).toBe("http://192.168.1.5:11434");
    expect(ok("HTTP://Ollama.Home.Lan:11434")).toBe("http://ollama.home.lan:11434");
  });

  it("assumes http when the scheme is left off", () => {
    expect(ok("my-server:11434")).toBe("http://my-server:11434");
    expect(ok("192.168.1.5:11434")).toBe("http://192.168.1.5:11434");
    expect(ok("localhost")).toBe("http://localhost");
  });

  it("accepts https", () => {
    expect(ok("https://ollama.example.com")).toBe("https://ollama.example.com");
  });

  it("refuses anything but http and https", () => {
    expect(refused("ftp://files.example.com")).toMatch(/http/i);
    expect(refused("file:///etc/passwd")).toMatch(/http/i);
    expect(refused("javascript:alert(1)")).toMatch(/http/i);
  });

  it("refuses an address with a user name or password in it", () => {
    expect(refused("http://me:secret@192.168.1.5:11434")).toMatch(/user name|password|credentials/i);
  });

  // The Fetch Standard's "bad ports", which Node's fetch (undici) refuses with "bad port"; 82 of them were
  // checked one by one against Node 24. A few from each end and the middle:
  it.each([1, 22, 25, 6000, 6669, 10080])("refuses port %i, which fetch will not connect to", (port) => {
    expect(refused(`http://192.168.1.5:${port}`)).toMatch(new RegExp(`port ${port}`, "i"));
  });

  it.each([443, 6001, 8080, 11434, 11435, 65535])("accepts port %i", (port) => {
    expect(ok(`http://192.168.1.5:${port}`)).toBe(`http://192.168.1.5:${port}`);
  });

  it("leaves out a port that is the scheme's own default", () => {
    expect(ok("http://192.168.1.5:80")).toBe("http://192.168.1.5");
    expect(ok("https://example.com:443")).toBe("https://example.com");
  });

  it("keeps a path prefix, for a server behind a reverse proxy, and drops the query and fragment", () => {
    expect(ok("https://example.com/ollama/")).toBe("https://example.com/ollama");
    expect(ok("http://192.168.1.5:11434/?x=1#top")).toBe("http://192.168.1.5:11434");
  });

  it("refuses text that is not an address", () => {
    expect(refused("not an address")).toMatch(/http/i);
    expect(refused("http://")).toMatch(/http/i);
    expect(refused("http://host:99999")).toMatch(/http/i);
  });
});

describe("isLoopback", () => {
  it.each([
    "http://127.0.0.1:11434",
    "http://127.8.9.10:11434",
    "http://localhost:11434",
    "http://LOCALHOST",
    "http://[::1]:11434",
    "http://ollama.localhost:11434",
    "http://0.0.0.0:11434",
  ])("treats %s as this machine", (url) => {
    expect(isLoopback(url)).toBe(true);
  });

  it.each([
    "http://192.168.1.5:11434",
    "http://10.0.0.2:11434",
    "https://ollama.example.com",
    "http://127.0.0.1.evil.example",
    "http://localhost.evil.example",
    "http://notlocalhost",
  ])("treats %s as another machine", (url) => {
    expect(isLoopback(url)).toBe(false);
  });

  it("treats something that is not an address as not local", () => {
    expect(isLoopback("not a url")).toBe(false);
  });
});
