import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArchiveError, readArchive, writeArchive } from "./tarArchive";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "composition-tar-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

async function readAll(file: string): Promise<Map<string, Buffer>> {
  const found = new Map<string, Buffer>();
  await readArchive(file, async ({ name, data }) => {
    const chunks: Buffer[] = [];
    for await (const chunk of data) chunks.push(chunk);
    found.set(name, Buffer.concat(chunks));
  });
  return found;
}

function source(name: string, bytes: Buffer): { name: string; file: string } {
  const file = path.join(dir, crypto.randomBytes(4).toString("hex"));
  fs.writeFileSync(file, bytes);
  return { name, file };
}

describe("writeArchive and readArchive", () => {
  it("round-trips in-memory contents and files from disk, byte for byte", async () => {
    const big = crypto.randomBytes(300_000); // several 64 KB chunks, and not a multiple of 512
    const target = path.join(dir, "out.tar.gz");

    await writeArchive(
      target,
      new Map([["note.json", Buffer.from('{"a":1}')]]),
      [source("big.bin", big), source("empty", Buffer.alloc(0)), source("exact-block", Buffer.alloc(512, 7))],
    );

    const found = await readAll(target);
    expect([...found.keys()]).toEqual(["note.json", "big.bin", "empty", "exact-block"]);
    expect(found.get("note.json")!.toString()).toBe('{"a":1}');
    expect(found.get("big.bin")!.equals(big)).toBe(true);
    expect(found.get("empty")!.length).toBe(0);
    expect(found.get("exact-block")!.equals(Buffer.alloc(512, 7))).toBe(true);
  });

  it("keeps names longer than 100 bytes, and non-ASCII ones", async () => {
    const long = `attachments/${"a".repeat(150)}.pdf`;
    const accented = "app_data/café-ünï-3f9c2a71b0de.png";
    const target = path.join(dir, "out.tar.gz");

    await writeArchive(target, new Map(), [source(long, Buffer.from("x")), source(accented, Buffer.from("y"))]);

    const found = await readAll(target);
    expect(found.get(long)?.toString()).toBe("x");
    expect(found.get(accented)?.toString()).toBe("y");
  });

  it("skips a file that vanished after it was listed", async () => {
    const target = path.join(dir, "out.tar.gz");

    await writeArchive(target, new Map(), [{ name: "gone", file: path.join(dir, "missing") }, source("here", Buffer.from("1"))]);

    expect([...(await readAll(target)).keys()]).toEqual(["here"]);
  });

  it("leaves no partial file behind when writing fails", async () => {
    const target = path.join(dir, "out.tar.gz");
    await writeArchive(target, new Map(), []);
    fs.rmSync(target);

    await expect(writeArchive(path.join(dir, "no-such-folder", "out.tar.gz"), new Map(), [])).rejects.toThrow();

    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("is readable by the system tar, and reads what the system tar writes", async () => {
    const target = path.join(dir, "ours.tar.gz");
    await writeArchive(target, new Map(), [source("one.txt", Buffer.from("hello")), source(`d/${"b".repeat(120)}`, Buffer.from("deep"))]);

    const listing = execFileSync("tar", ["-tzf", target], { encoding: "utf-8" }).trim().split("\n");
    expect(listing).toEqual(["one.txt", `d/${"b".repeat(120)}`]);

    const folder = path.join(dir, "theirs");
    fs.mkdirSync(path.join(folder, "sub"), { recursive: true });
    fs.writeFileSync(path.join(folder, "sub", "f.txt"), "from tar");
    const theirs = path.join(dir, "theirs.tar.gz");
    execFileSync("tar", ["-czf", theirs, "-C", folder, "sub"], { env: { ...process.env, COPYFILE_DISABLE: "1" } });

    expect((await readAll(theirs)).get("sub/f.txt")?.toString()).toBe("from tar");
  });
});

describe("readArchive refuses", () => {
  it("a file that is not an archive", async () => {
    const file = path.join(dir, "junk.tar.gz");
    fs.writeFileSync(file, crypto.randomBytes(2000));
    await expect(readAll(file)).rejects.toBeInstanceOf(ArchiveError);
  });

  it("gzip data that is not a tar", async () => {
    const file = path.join(dir, "text.tar.gz");
    execFileSync("sh", ["-c", `echo 'just text' | gzip > '${file}'`]);
    await expect(readAll(file)).rejects.toBeInstanceOf(ArchiveError);
  });

  it("an archive cut short", async () => {
    const target = path.join(dir, "out.tar.gz");
    await writeArchive(target, new Map(), [source("big.bin", crypto.randomBytes(400_000))]);
    const bytes = fs.readFileSync(target);
    fs.writeFileSync(target, bytes.subarray(0, Math.floor(bytes.length / 2)));

    await expect(readAll(target)).rejects.toBeInstanceOf(ArchiveError);
  });

  it("a symbolic link, even though it is only a link", async () => {
    const folder = path.join(dir, "src");
    fs.mkdirSync(folder);
    fs.symlinkSync("/etc/passwd", path.join(folder, "link"));
    const target = path.join(dir, "evil.tar.gz");
    execFileSync("tar", ["-czf", target, "-C", folder, "link"]);

    await expect(readAll(target)).rejects.toThrow(/other than files/);
  });

  it("a missing file", async () => {
    await expect(readAll(path.join(dir, "nope.tar.gz"))).rejects.toThrow();
  });
});
