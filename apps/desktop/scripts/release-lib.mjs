// Pure helpers for scripts/release.mjs. Nothing here touches the disk or the
// network, so the tests can cover it without a Mac, a certificate or Apple.
import path from "node:path";

export const TAG_PREFIX = "desktop-v";

/** The architectures a release builds, and how each one is named by the tools involved. `platform` is the key used by the lock files and resources/ folders. */
export const ARCHES = {
  arm64: { builderFlag: "--arm64", platform: "mac-arm64", lipo: "arm64" },
  x64: { builderFlag: "--x64", platform: "mac-x64", lipo: "x86_64" },
};

/** "desktop-v1.2.3" -> "1.2.3". Null if the tag isn't a desktop release tag. */
export function tagVersion(tag) {
  if (typeof tag !== "string" || !tag.startsWith(TAG_PREFIX)) return null;
  const version = tag.slice(TAG_PREFIX.length);
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version) ? version : null;
}

export function archesFor(choice) {
  return choice === "both" ? Object.keys(ARCHES) : [choice];
}

/** @returns {{arch: string, unsigned: boolean, check: boolean, tag: string | null, help: boolean}} */
export function parseArgs(argv) {
  const options = { arch: "both", unsigned: false, check: false, tag: null, help: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--unsigned") options.unsigned = true;
    else if (arg === "--check") options.check = true;
    else if (arg === "--arch" || arg === "--tag") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} needs a value`);
      options[arg.slice(2)] = value;
    } else if (arg.startsWith("--arch=") || arg.startsWith("--tag=")) {
      const [name, ...rest] = arg.slice(2).split("=");
      options[name] = rest.join("=");
    } else throw new Error(`Unknown option: ${arg}`);
  }

  if (options.arch !== "both" && !(options.arch in ARCHES)) {
    throw new Error(`--arch must be arm64, x64 or both, got "${options.arch}"`);
  }
  if (options.tag !== null && tagVersion(options.tag) === null) {
    throw new Error(`--tag must look like ${TAG_PREFIX}1.2.3, got "${options.tag}"`);
  }
  return options;
}

/**
 * Reads the output of `security find-identity -p codesigning` (without -v). It lists every
 * identity, then a "Valid identities only" section; an identity in the first list but not the
 * second is installed but not usable (usually a missing Developer ID - G2 intermediate, or an
 * expired certificate).
 *
 * An identity is a certificate *and* its private key: a certificate whose key is missing
 * doesn't appear at all.
 *
 * @returns {{valid: {hash: string, name: string}[], unusable: {hash: string, name: string}[]}}
 */
export function parseSigningIdentities(output) {
  const line = /^\s*\d+\)\s+([0-9A-F]{40})\s+"([^"]+)"/;
  const all = [];
  const valid = [];
  let inValid = false;

  for (const text of output.split(/\r?\n/)) {
    if (/Valid identities only/i.test(text)) inValid = true;
    const match = line.exec(text);
    if (!match) continue;
    (inValid ? valid : all).push({ hash: match[1], name: match[2] });
  }

  const validHashes = new Set(valid.map((identity) => identity.hash));
  return {
    valid: valid.filter((identity) => identity.name.startsWith("Developer ID Application:")),
    unusable: all.filter(
      (identity) => identity.name.startsWith("Developer ID Application:") && !validHashes.has(identity.hash),
    ),
  };
}

/** True if `file` is inside `root`, where a credential could end up committed by accident. */
export function isInside(root, file) {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/** The SHA256SUMS.txt body, in the format `shasum -a 256` writes and `shasum -c` reads. */
export function checksumFile(entries) {
  return entries.map(({ name, sha256 }) => `${sha256}  ${name}\n`).join("");
}

/**
 * Checks the text of `latest-mac.yml`, the file installed apps read to find an update. It
 * must name this version and a ZIP for every architecture built: an app whose architecture is
 * missing would silently never update. Returns the problems; empty means it's good.
 *
 * Deliberately reads lines rather than parsing YAML: the file is written by electron-builder
 * in one fixed shape, and this needs no dependency.
 *
 * @param {string} text
 * @param {string} version  desktop version, e.g. "0.2.0"
 * @param {string[]} arches  keys of ARCHES
 * @param {string} productName  e.g. "Composition"
 */
export function checkUpdateFeed(text, version, arches, productName) {
  const problems = [];
  const feedVersion = /^version:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(text)?.[1];
  if (feedVersion !== version) {
    problems.push(`latest-mac.yml says version ${feedVersion ?? "(none)"}, expected ${version}.`);
  }
  const urls = [...text.matchAll(/^\s*(?:-\s+)?url:\s*['"]?([^'"\s]+)['"]?\s*$/gm)].map((match) => match[1]);
  for (const arch of arches) {
    const zip = `${productName}-${version}-${arch}.zip`;
    if (!urls.includes(zip)) problems.push(`latest-mac.yml doesn't list ${zip}; ${arch} Macs would never update.`);
  }
  if (!/^\s*sha512:\s*\S+/m.test(text)) problems.push("latest-mac.yml has no sha512 checksums.");
  return problems;
}

/** Files in release/ that go on the GitHub Release: the downloads, the update feed and its blockmaps (for small, differential updates). */
export function releaseAssetNames(files) {
  return files
    .filter((file) => /\.(dmg|zip|blockmap)$/.test(file) || file === "latest-mac.yml" || file === "SHA256SUMS.txt")
    .sort();
}

// Mach-O headers: 32/64-bit in either byte order, and the "fat" universal header. Every
// executable inside a signed app must be one of these, and must itself carry a signature.
const MACH_O_MAGIC = new Set(["feedface", "feedfacf", "cefaedfe", "cffaedfe", "cafebabe", "bebafeca"]);

/** True if `head` (the first bytes of a file) starts like a Mach-O binary. */
export function isMachO(head) {
  return head.length >= 4 && MACH_O_MAGIC.has(Buffer.from(head.subarray(0, 4)).toString("hex"));
}
