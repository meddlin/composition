import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/tools/seed.ts
import fs7 from "node:fs";
import os3 from "node:os";
import path8 from "node:path";

// src/tools/seedNotes.ts
import Database2 from "better-sqlite3";

// ../web/src/lib/composition/db.ts
import fs2 from "node:fs";
import path3 from "node:path";
import Database from "better-sqlite3";

// ../web/src/lib/composition/webSettings.ts
import fs from "node:fs";
import os2 from "node:os";
import path2 from "node:path";

// ../web/src/lib/composition/favorites.ts
var NO_FAVORITES = [];
function isFavorite(favorites, type2, id) {
  return favorites.some((f2) => f2.type === type2 && f2.id === id);
}
function parseFavorites(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  for (const entry of value) {
    const { type: type2, id } = entry ?? {};
    if (type2 !== "group" && type2 !== "note") continue;
    if (!Number.isSafeInteger(id)) continue;
    if (isFavorite(result, type2, id)) continue;
    result.push({ type: type2, id });
  }
  return result;
}

// ../web/src/lib/composition/layout.ts
var DEFAULT_SIDEBAR_WIDTH = 256;
var MIN_SIDEBAR_WIDTH = 160;
var MAX_SIDEBAR_WIDTH = 480;
var DEFAULT_EDITOR_RATIO = 0.5;
var MIN_EDITOR_RATIO = 0.2;
var MAX_EDITOR_RATIO = 0.8;
var DEFAULT_LAYOUT = {
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  editorRatio: DEFAULT_EDITOR_RATIO
};
function clamp(value, fallback, min, max) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}
function clampSidebarWidth(value) {
  return clamp(value, DEFAULT_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
}
function clampEditorRatio(value) {
  return clamp(value, DEFAULT_EDITOR_RATIO, MIN_EDITOR_RATIO, MAX_EDITOR_RATIO);
}

// ../web/src/lib/composition/paths.ts
import os from "node:os";
import path from "node:path";
var DEFAULT_APP_DATA_DIR = path.join(os.homedir(), ".composition");
function defaultDatabasePath(appDataDir) {
  return path.join(appDataDir, "composition.db");
}
function expandHome(input) {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

// ../web/src/lib/composition/themes.ts
var THEME_CHOICES = [
  { name: "dark", label: "Dark" },
  { name: "light", label: "Light" },
  { name: "forest", label: "Forest (dark green)" },
  { name: "cream", label: "Cream (warm light)" },
  { name: "auto", label: "Follow the sun (dark at night, light by day)" }
];
var DEFAULT_THEME = "dark";
function isThemeName(value) {
  return THEME_CHOICES.some((choice) => choice.name === value);
}

// ../web/src/lib/composition/webSettings.ts
var DEFAULT_SETTINGS_PATH = path2.join(os2.homedir(), ".composition-web", "settings.json");
function settingsPath() {
  return process.env.COMPOSITION_SETTINGS_PATH || DEFAULT_SETTINGS_PATH;
}
var DEFAULT_SETTINGS = {
  appDataDir: DEFAULT_APP_DATA_DIR,
  theme: DEFAULT_THEME,
  ...DEFAULT_LAYOUT,
  favorites: NO_FAVORITES
};
function parseLocation(value) {
  const data = value;
  if (typeof data?.name !== "string" || data.name === "" || typeof data.timezone !== "string" || data.timezone === "" || typeof data.latitude !== "number" || !(Math.abs(data.latitude) <= 90) || typeof data.longitude !== "number" || !(Math.abs(data.longitude) <= 180)) {
    return void 0;
  }
  return {
    name: data.name,
    latitude: data.latitude,
    longitude: data.longitude,
    timezone: data.timezone
  };
}
function loadWebSettings() {
  try {
    const raw = fs.readFileSync(settingsPath(), "utf-8");
    const data = JSON.parse(raw);
    const hasAppDataDir = typeof data?.appDataDir === "string" && data.appDataDir !== "";
    const settings2 = {
      appDataDir: hasAppDataDir ? data.appDataDir : DEFAULT_APP_DATA_DIR,
      theme: isThemeName(data.theme) ? data.theme : DEFAULT_THEME,
      sidebarWidth: clampSidebarWidth(data.sidebarWidth),
      editorRatio: clampEditorRatio(data.editorRatio),
      favorites: parseFavorites(data.favorites)
    };
    if (typeof data.dbPath === "string" && data.dbPath !== "") {
      settings2.dbPath = data.dbPath;
    }
    const location = parseLocation(data.location);
    if (location) settings2.location = location;
    return settings2;
  } catch {
    return DEFAULT_SETTINGS;
  }
}
function saveWebSettings(settings2) {
  const file = settingsPath();
  const dir = path2.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const temporaryPath = path2.join(dir, `.${path2.basename(file)}.tmp`);
  fs.writeFileSync(temporaryPath, JSON.stringify(settings2, null, 2));
  fs.renameSync(temporaryPath, file);
}
function resolvedDbPath(settings2) {
  return settings2.dbPath || defaultDatabasePath(settings2.appDataDir);
}

// ../web/src/lib/composition/db.ts
var SCHEMA = `
CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
`;
var GROUPS_SCHEMA = `
CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    parent_id INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
`;
var TRASH_SCHEMA = `
CREATE TABLE IF NOT EXISTS trashed_notes (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    group_id INTEGER,
    deleted_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS trashed_groups (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NOT NULL
);
`;
var ATTACHMENTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id INTEGER NOT NULL,
    file_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_note_id ON attachments (note_id);
`;
function ensureColumn(db, column, ddl) {
  const columns = db.prepare("PRAGMA table_info(notes)").all();
  if (!columns.some((c2) => c2.name === column)) {
    db.exec(ddl);
  }
}
function openConnection(dbPath) {
  fs2.mkdirSync(path3.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  db.exec(GROUPS_SCHEMA);
  db.exec(TRASH_SCHEMA);
  db.exec(ATTACHMENTS_SCHEMA);
  ensureColumn(db, "tags", "ALTER TABLE notes ADD COLUMN tags TEXT NOT NULL DEFAULT ''");
  ensureColumn(
    db,
    "description",
    "ALTER TABLE notes ADD COLUMN description TEXT NOT NULL DEFAULT ''"
  );
  ensureColumn(db, "group_id", "ALTER TABLE notes ADD COLUMN group_id INTEGER");
  return db;
}
function getDb() {
  const dbPath = resolvedDbPath(loadWebSettings());
  if (globalThis.__compositionDb && globalThis.__compositionDb.dbPath === dbPath) {
    return globalThis.__compositionDb.connection;
  }
  if (globalThis.__compositionDb) {
    globalThis.__compositionDb.connection.close();
  }
  const connection = openConnection(dbPath);
  globalThis.__compositionDb = { connection, dbPath };
  return connection;
}
function closeDb() {
  if (globalThis.__compositionDb) {
    globalThis.__compositionDb.connection.close();
    globalThis.__compositionDb = void 0;
  }
}

// ../web/src/lib/composition/imageRefs.ts
var IMAGE_DIR_NAME = "app_data";
var MAX_IMAGE_BYTES = 10 * 1024 * 1024;
var IMAGE_CONTENT_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp"
};
var IMAGE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpe?g|gif|webp)$/i;
function isImageName(name) {
  return IMAGE_NAME.test(name);
}

// ../web/src/lib/composition/attachmentNames.ts
var ATTACHMENT_DIR_NAME = "attachments";
var MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
var MAX_STORED_NAME_LENGTH = 100;
function storedFileName(uniquePrefix, fileName) {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  const rawStem = dot > 0 ? base.slice(0, dot) : base;
  const rawExt = dot > 0 ? base.slice(dot + 1) : "";
  const clean = (text) => text.normalize("NFKD").replace(/[^A-Za-z0-9_-]+/g, "_");
  const ext = clean(rawExt).replace(/^_+|_+$/g, "").slice(0, 20);
  const stem = clean(rawStem).replace(/^[._]+/, "").slice(0, MAX_STORED_NAME_LENGTH) || "file";
  return `${uniquePrefix}-${stem}${ext ? `.${ext}` : ""}`;
}
function displayName(filePath) {
  return filePath.split(/[\\/]/).pop() || "file";
}
function formatBytes(bytes) {
  if (bytes < 1e3) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1e3;
  let unit = 0;
  while (value >= 1e3 && unit < units.length - 1) {
    value /= 1e3;
    unit += 1;
  }
  return `${value >= 100 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`;
}

// ../web/src/lib/composition/frontmatter.ts
var frontmatter_exports = {};
__export(frontmatter_exports, {
  generate: () => generate,
  parse: () => parse,
  render: () => render,
  strip: () => strip,
  tagsFromString: () => tagsFromString,
  tagsToString: () => tagsToString
});

// ../web/node_modules/.pnpm/js-yaml@4.3.2/node_modules/js-yaml/dist/js-yaml.mjs
function getDefaultExportFromCjs(x2) {
  return x2 && x2.__esModule && Object.prototype.hasOwnProperty.call(x2, "default") ? x2["default"] : x2;
}
var jsYaml = {};
var loader = {};
var common = {};
var hasRequiredCommon;
function requireCommon() {
  if (hasRequiredCommon) return common;
  hasRequiredCommon = 1;
  function isNothing(subject) {
    return typeof subject === "undefined" || subject === null;
  }
  function isObject(subject) {
    return typeof subject === "object" && subject !== null;
  }
  function toArray(sequence) {
    if (Array.isArray(sequence)) return sequence;
    else if (isNothing(sequence)) return [];
    return [sequence];
  }
  function extend(target, source) {
    if (source) {
      const sourceKeys = Object.keys(source);
      for (let index = 0, length = sourceKeys.length; index < length; index += 1) {
        const key = sourceKeys[index];
        target[key] = source[key];
      }
    }
    return target;
  }
  function repeat(string, count2) {
    let result = "";
    for (let cycle = 0; cycle < count2; cycle += 1) {
      result += string;
    }
    return result;
  }
  function isNegativeZero(number) {
    return number === 0 && Number.NEGATIVE_INFINITY === 1 / number;
  }
  common.isNothing = isNothing;
  common.isObject = isObject;
  common.toArray = toArray;
  common.repeat = repeat;
  common.isNegativeZero = isNegativeZero;
  common.extend = extend;
  return common;
}
var exception;
var hasRequiredException;
function requireException() {
  if (hasRequiredException) return exception;
  hasRequiredException = 1;
  function formatError(exception2, compact) {
    let where = "";
    const message = exception2.reason || "(unknown reason)";
    if (!exception2.mark) return message;
    if (exception2.mark.name) {
      where += 'in "' + exception2.mark.name + '" ';
    }
    where += "(" + (exception2.mark.line + 1) + ":" + (exception2.mark.column + 1) + ")";
    if (!compact && exception2.mark.snippet) {
      where += "\n\n" + exception2.mark.snippet;
    }
    return message + " " + where;
  }
  function YAMLException2(reason, mark) {
    Error.call(this);
    this.name = "YAMLException";
    this.reason = reason;
    this.mark = mark;
    this.message = formatError(this, false);
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    } else {
      this.stack = new Error().stack || "";
    }
  }
  YAMLException2.prototype = Object.create(Error.prototype);
  YAMLException2.prototype.constructor = YAMLException2;
  YAMLException2.prototype.toString = function toString(compact) {
    return this.name + ": " + formatError(this, compact);
  };
  exception = YAMLException2;
  return exception;
}
var snippet;
var hasRequiredSnippet;
function requireSnippet() {
  if (hasRequiredSnippet) return snippet;
  hasRequiredSnippet = 1;
  const common2 = requireCommon();
  function getLine(buffer, lineStart, lineEnd, position, maxLineLength) {
    let head = "";
    let tail = "";
    const maxHalfLength = Math.floor(maxLineLength / 2) - 1;
    if (position - lineStart > maxHalfLength) {
      head = " ... ";
      lineStart = position - maxHalfLength + head.length;
    }
    if (lineEnd - position > maxHalfLength) {
      tail = " ...";
      lineEnd = position + maxHalfLength - tail.length;
    }
    return {
      str: head + buffer.slice(lineStart, lineEnd).replace(/\t/g, "\u2192") + tail,
      pos: position - lineStart + head.length
      // relative position
    };
  }
  function padStart(string, max) {
    return common2.repeat(" ", max - string.length) + string;
  }
  function makeSnippet(mark, options) {
    options = Object.create(options || null);
    if (!mark.buffer) return null;
    if (!options.maxLength) options.maxLength = 79;
    if (typeof options.indent !== "number") options.indent = 1;
    if (typeof options.linesBefore !== "number") options.linesBefore = 3;
    if (typeof options.linesAfter !== "number") options.linesAfter = 2;
    const re = /\r?\n|\r|\0/g;
    const lineStarts = [0];
    const lineEnds = [];
    let match;
    let foundLineNo = -1;
    while (match = re.exec(mark.buffer)) {
      lineEnds.push(match.index);
      lineStarts.push(match.index + match[0].length);
      if (mark.position <= match.index && foundLineNo < 0) {
        foundLineNo = lineStarts.length - 2;
      }
    }
    if (foundLineNo < 0) foundLineNo = lineStarts.length - 1;
    let result = "";
    const lineNoLength = Math.min(mark.line + options.linesAfter, lineEnds.length).toString().length;
    const maxLineLength = options.maxLength - (options.indent + lineNoLength + 3);
    for (let i2 = 1; i2 <= options.linesBefore; i2++) {
      if (foundLineNo - i2 < 0) break;
      const line2 = getLine(
        mark.buffer,
        lineStarts[foundLineNo - i2],
        lineEnds[foundLineNo - i2],
        mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo - i2]),
        maxLineLength
      );
      result = common2.repeat(" ", options.indent) + padStart((mark.line - i2 + 1).toString(), lineNoLength) + " | " + line2.str + "\n" + result;
    }
    const line = getLine(mark.buffer, lineStarts[foundLineNo], lineEnds[foundLineNo], mark.position, maxLineLength);
    result += common2.repeat(" ", options.indent) + padStart((mark.line + 1).toString(), lineNoLength) + " | " + line.str + "\n";
    result += common2.repeat("-", options.indent + lineNoLength + 3 + line.pos) + "^\n";
    for (let i2 = 1; i2 <= options.linesAfter; i2++) {
      if (foundLineNo + i2 >= lineEnds.length) break;
      const line2 = getLine(
        mark.buffer,
        lineStarts[foundLineNo + i2],
        lineEnds[foundLineNo + i2],
        mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo + i2]),
        maxLineLength
      );
      result += common2.repeat(" ", options.indent) + padStart((mark.line + i2 + 1).toString(), lineNoLength) + " | " + line2.str + "\n";
    }
    return result.replace(/\n$/, "");
  }
  snippet = makeSnippet;
  return snippet;
}
var type;
var hasRequiredType;
function requireType() {
  if (hasRequiredType) return type;
  hasRequiredType = 1;
  const YAMLException2 = requireException();
  const TYPE_CONSTRUCTOR_OPTIONS = [
    "kind",
    "multi",
    "resolve",
    "construct",
    "instanceOf",
    "predicate",
    "represent",
    "representName",
    "defaultStyle",
    "styleAliases"
  ];
  const YAML_NODE_KINDS = [
    "scalar",
    "sequence",
    "mapping"
  ];
  function compileStyleAliases(map2) {
    const result = {};
    if (map2 !== null) {
      Object.keys(map2).forEach(function(style) {
        map2[style].forEach(function(alias) {
          result[String(alias)] = style;
        });
      });
    }
    return result;
  }
  function Type2(tag, options) {
    options = options || {};
    Object.keys(options).forEach(function(name) {
      if (TYPE_CONSTRUCTOR_OPTIONS.indexOf(name) === -1) {
        throw new YAMLException2('Unknown option "' + name + '" is met in definition of "' + tag + '" YAML type.');
      }
    });
    this.options = options;
    this.tag = tag;
    this.kind = options["kind"] || null;
    this.resolve = options["resolve"] || function() {
      return true;
    };
    this.construct = options["construct"] || function(data) {
      return data;
    };
    this.instanceOf = options["instanceOf"] || null;
    this.predicate = options["predicate"] || null;
    this.represent = options["represent"] || null;
    this.representName = options["representName"] || null;
    this.defaultStyle = options["defaultStyle"] || null;
    this.multi = options["multi"] || false;
    this.styleAliases = compileStyleAliases(options["styleAliases"] || null);
    if (YAML_NODE_KINDS.indexOf(this.kind) === -1) {
      throw new YAMLException2('Unknown kind "' + this.kind + '" is specified for "' + tag + '" YAML type.');
    }
  }
  type = Type2;
  return type;
}
var schema;
var hasRequiredSchema;
function requireSchema() {
  if (hasRequiredSchema) return schema;
  hasRequiredSchema = 1;
  const YAMLException2 = requireException();
  const Type2 = requireType();
  function compileList(schema2, name) {
    const result = [];
    schema2[name].forEach(function(currentType) {
      let newIndex = result.length;
      result.forEach(function(previousType, previousIndex) {
        if (previousType.tag === currentType.tag && previousType.kind === currentType.kind && previousType.multi === currentType.multi) {
          newIndex = previousIndex;
        }
      });
      result[newIndex] = currentType;
    });
    return result;
  }
  function compileMap() {
    const result = {
      scalar: {},
      sequence: {},
      mapping: {},
      fallback: {},
      multi: {
        scalar: [],
        sequence: [],
        mapping: [],
        fallback: []
      }
    };
    function collectType(type2) {
      if (type2.multi) {
        result.multi[type2.kind].push(type2);
        result.multi["fallback"].push(type2);
      } else {
        result[type2.kind][type2.tag] = result["fallback"][type2.tag] = type2;
      }
    }
    for (let index = 0, length = arguments.length; index < length; index += 1) {
      arguments[index].forEach(collectType);
    }
    return result;
  }
  function Schema2(definition) {
    return this.extend(definition);
  }
  Schema2.prototype.extend = function extend(definition) {
    let implicit = [];
    let explicit = [];
    if (definition instanceof Type2) {
      explicit.push(definition);
    } else if (Array.isArray(definition)) {
      explicit = explicit.concat(definition);
    } else if (definition && (Array.isArray(definition.implicit) || Array.isArray(definition.explicit))) {
      if (definition.implicit) implicit = implicit.concat(definition.implicit);
      if (definition.explicit) explicit = explicit.concat(definition.explicit);
    } else {
      throw new YAMLException2("Schema.extend argument should be a Type, [ Type ], or a schema definition ({ implicit: [...], explicit: [...] })");
    }
    implicit.forEach(function(type2) {
      if (!(type2 instanceof Type2)) {
        throw new YAMLException2("Specified list of YAML types (or a single Type object) contains a non-Type object.");
      }
      if (type2.loadKind && type2.loadKind !== "scalar") {
        throw new YAMLException2("There is a non-scalar type in the implicit list of a schema. Implicit resolving of such types is not supported.");
      }
      if (type2.multi) {
        throw new YAMLException2("There is a multi type in the implicit list of a schema. Multi tags can only be listed as explicit.");
      }
    });
    explicit.forEach(function(type2) {
      if (!(type2 instanceof Type2)) {
        throw new YAMLException2("Specified list of YAML types (or a single Type object) contains a non-Type object.");
      }
    });
    const result = Object.create(Schema2.prototype);
    result.implicit = (this.implicit || []).concat(implicit);
    result.explicit = (this.explicit || []).concat(explicit);
    result.compiledImplicit = compileList(result, "implicit");
    result.compiledExplicit = compileList(result, "explicit");
    result.compiledTypeMap = compileMap(result.compiledImplicit, result.compiledExplicit);
    return result;
  };
  schema = Schema2;
  return schema;
}
var str;
var hasRequiredStr;
function requireStr() {
  if (hasRequiredStr) return str;
  hasRequiredStr = 1;
  const Type2 = requireType();
  str = new Type2("tag:yaml.org,2002:str", {
    kind: "scalar",
    construct: function(data) {
      return data !== null ? data : "";
    }
  });
  return str;
}
var seq;
var hasRequiredSeq;
function requireSeq() {
  if (hasRequiredSeq) return seq;
  hasRequiredSeq = 1;
  const Type2 = requireType();
  seq = new Type2("tag:yaml.org,2002:seq", {
    kind: "sequence",
    construct: function(data) {
      return data !== null ? data : [];
    }
  });
  return seq;
}
var map;
var hasRequiredMap;
function requireMap() {
  if (hasRequiredMap) return map;
  hasRequiredMap = 1;
  const Type2 = requireType();
  map = new Type2("tag:yaml.org,2002:map", {
    kind: "mapping",
    construct: function(data) {
      return data !== null ? data : {};
    }
  });
  return map;
}
var failsafe;
var hasRequiredFailsafe;
function requireFailsafe() {
  if (hasRequiredFailsafe) return failsafe;
  hasRequiredFailsafe = 1;
  const Schema2 = requireSchema();
  failsafe = new Schema2({
    explicit: [
      requireStr(),
      requireSeq(),
      requireMap()
    ]
  });
  return failsafe;
}
var _null;
var hasRequired_null;
function require_null() {
  if (hasRequired_null) return _null;
  hasRequired_null = 1;
  const Type2 = requireType();
  function resolveYamlNull(data) {
    if (data === null) return true;
    const max = data.length;
    return max === 1 && data === "~" || max === 4 && (data === "null" || data === "Null" || data === "NULL");
  }
  function constructYamlNull() {
    return null;
  }
  function isNull(object) {
    return object === null;
  }
  _null = new Type2("tag:yaml.org,2002:null", {
    kind: "scalar",
    resolve: resolveYamlNull,
    construct: constructYamlNull,
    predicate: isNull,
    represent: {
      canonical: function() {
        return "~";
      },
      lowercase: function() {
        return "null";
      },
      uppercase: function() {
        return "NULL";
      },
      camelcase: function() {
        return "Null";
      },
      empty: function() {
        return "";
      }
    },
    defaultStyle: "lowercase"
  });
  return _null;
}
var bool;
var hasRequiredBool;
function requireBool() {
  if (hasRequiredBool) return bool;
  hasRequiredBool = 1;
  const Type2 = requireType();
  function resolveYamlBoolean(data) {
    if (data === null) return false;
    const max = data.length;
    return max === 4 && (data === "true" || data === "True" || data === "TRUE") || max === 5 && (data === "false" || data === "False" || data === "FALSE");
  }
  function constructYamlBoolean(data) {
    return data === "true" || data === "True" || data === "TRUE";
  }
  function isBoolean(object) {
    return Object.prototype.toString.call(object) === "[object Boolean]";
  }
  bool = new Type2("tag:yaml.org,2002:bool", {
    kind: "scalar",
    resolve: resolveYamlBoolean,
    construct: constructYamlBoolean,
    predicate: isBoolean,
    represent: {
      lowercase: function(object) {
        return object ? "true" : "false";
      },
      uppercase: function(object) {
        return object ? "TRUE" : "FALSE";
      },
      camelcase: function(object) {
        return object ? "True" : "False";
      }
    },
    defaultStyle: "lowercase"
  });
  return bool;
}
var int;
var hasRequiredInt;
function requireInt() {
  if (hasRequiredInt) return int;
  hasRequiredInt = 1;
  const common2 = requireCommon();
  const Type2 = requireType();
  function isHexCode(c2) {
    return c2 >= 48 && c2 <= 57 || c2 >= 65 && c2 <= 70 || c2 >= 97 && c2 <= 102;
  }
  function isOctCode(c2) {
    return c2 >= 48 && c2 <= 55;
  }
  function isDecCode(c2) {
    return c2 >= 48 && c2 <= 57;
  }
  function resolveYamlInteger(data) {
    if (data === null) return false;
    const max = data.length;
    let index = 0;
    let hasDigits = false;
    if (!max) return false;
    let ch = data[index];
    if (ch === "-" || ch === "+") {
      ch = data[++index];
    }
    if (ch === "0") {
      if (index + 1 === max) return true;
      ch = data[++index];
      if (ch === "b") {
        index++;
        for (; index < max; index++) {
          ch = data[index];
          if (ch !== "0" && ch !== "1") return false;
          hasDigits = true;
        }
        return hasDigits && isFinite(parseYamlInteger(data));
      }
      if (ch === "x") {
        index++;
        for (; index < max; index++) {
          if (!isHexCode(data.charCodeAt(index))) return false;
          hasDigits = true;
        }
        return hasDigits && isFinite(parseYamlInteger(data));
      }
      if (ch === "o") {
        index++;
        for (; index < max; index++) {
          if (!isOctCode(data.charCodeAt(index))) return false;
          hasDigits = true;
        }
        return hasDigits && isFinite(parseYamlInteger(data));
      }
    }
    for (; index < max; index++) {
      if (!isDecCode(data.charCodeAt(index))) {
        return false;
      }
      hasDigits = true;
    }
    if (!hasDigits) return false;
    return isFinite(parseYamlInteger(data));
  }
  function parseYamlInteger(data) {
    let value = data;
    let sign = 1;
    let ch = value[0];
    if (ch === "-" || ch === "+") {
      if (ch === "-") sign = -1;
      value = value.slice(1);
      ch = value[0];
    }
    if (value === "0") return 0;
    if (ch === "0") {
      if (value[1] === "b") return sign * parseInt(value.slice(2), 2);
      if (value[1] === "x") return sign * parseInt(value.slice(2), 16);
      if (value[1] === "o") return sign * parseInt(value.slice(2), 8);
    }
    return sign * parseInt(value, 10);
  }
  function constructYamlInteger(data) {
    return parseYamlInteger(data);
  }
  function isInteger(object) {
    return Object.prototype.toString.call(object) === "[object Number]" && (object % 1 === 0 && !common2.isNegativeZero(object));
  }
  int = new Type2("tag:yaml.org,2002:int", {
    kind: "scalar",
    resolve: resolveYamlInteger,
    construct: constructYamlInteger,
    predicate: isInteger,
    represent: {
      binary: function(obj) {
        return obj >= 0 ? "0b" + obj.toString(2) : "-0b" + obj.toString(2).slice(1);
      },
      octal: function(obj) {
        return obj >= 0 ? "0o" + obj.toString(8) : "-0o" + obj.toString(8).slice(1);
      },
      decimal: function(obj) {
        return obj.toString(10);
      },
      hexadecimal: function(obj) {
        return obj >= 0 ? "0x" + obj.toString(16).toUpperCase() : "-0x" + obj.toString(16).toUpperCase().slice(1);
      }
    },
    defaultStyle: "decimal",
    styleAliases: {
      binary: [2, "bin"],
      octal: [8, "oct"],
      decimal: [10, "dec"],
      hexadecimal: [16, "hex"]
    }
  });
  return int;
}
var float;
var hasRequiredFloat;
function requireFloat() {
  if (hasRequiredFloat) return float;
  hasRequiredFloat = 1;
  const common2 = requireCommon();
  const Type2 = requireType();
  const YAML_FLOAT_PATTERN = new RegExp(
    // 2.5e4, 2.5 and integers
    "^(?:[-+]?(?:[0-9]+)(?:\\.[0-9]*)?(?:[eE][-+]?[0-9]+)?|\\.[0-9]+(?:[eE][-+]?[0-9]+)?|[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$"
  );
  const YAML_FLOAT_SPECIAL_PATTERN = new RegExp(
    "^(?:[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$"
  );
  function resolveYamlFloat(data) {
    if (data === null) return false;
    if (!YAML_FLOAT_PATTERN.test(data)) {
      return false;
    }
    if (isFinite(parseFloat(data, 10))) {
      return true;
    }
    return YAML_FLOAT_SPECIAL_PATTERN.test(data);
  }
  function constructYamlFloat(data) {
    let value = data.toLowerCase();
    const sign = value[0] === "-" ? -1 : 1;
    if ("+-".indexOf(value[0]) >= 0) {
      value = value.slice(1);
    }
    if (value === ".inf") {
      return sign === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    } else if (value === ".nan") {
      return NaN;
    }
    return sign * parseFloat(value, 10);
  }
  const SCIENTIFIC_WITHOUT_DOT = /^[-+]?[0-9]+e/;
  function representYamlFloat(object, style) {
    if (isNaN(object)) {
      switch (style) {
        case "lowercase":
          return ".nan";
        case "uppercase":
          return ".NAN";
        case "camelcase":
          return ".NaN";
      }
    } else if (Number.POSITIVE_INFINITY === object) {
      switch (style) {
        case "lowercase":
          return ".inf";
        case "uppercase":
          return ".INF";
        case "camelcase":
          return ".Inf";
      }
    } else if (Number.NEGATIVE_INFINITY === object) {
      switch (style) {
        case "lowercase":
          return "-.inf";
        case "uppercase":
          return "-.INF";
        case "camelcase":
          return "-.Inf";
      }
    } else if (common2.isNegativeZero(object)) {
      return "-0.0";
    }
    const res = object.toString(10);
    return SCIENTIFIC_WITHOUT_DOT.test(res) ? res.replace("e", ".e") : res;
  }
  function isFloat(object) {
    return Object.prototype.toString.call(object) === "[object Number]" && (object % 1 !== 0 || common2.isNegativeZero(object));
  }
  float = new Type2("tag:yaml.org,2002:float", {
    kind: "scalar",
    resolve: resolveYamlFloat,
    construct: constructYamlFloat,
    predicate: isFloat,
    represent: representYamlFloat,
    defaultStyle: "lowercase"
  });
  return float;
}
var json;
var hasRequiredJson;
function requireJson() {
  if (hasRequiredJson) return json;
  hasRequiredJson = 1;
  json = requireFailsafe().extend({
    implicit: [
      require_null(),
      requireBool(),
      requireInt(),
      requireFloat()
    ]
  });
  return json;
}
var core;
var hasRequiredCore;
function requireCore() {
  if (hasRequiredCore) return core;
  hasRequiredCore = 1;
  core = requireJson();
  return core;
}
var timestamp;
var hasRequiredTimestamp;
function requireTimestamp() {
  if (hasRequiredTimestamp) return timestamp;
  hasRequiredTimestamp = 1;
  const Type2 = requireType();
  const YAML_DATE_REGEXP = new RegExp(
    "^([0-9][0-9][0-9][0-9])-([0-9][0-9])-([0-9][0-9])$"
  );
  const YAML_TIMESTAMP_REGEXP = new RegExp(
    "^([0-9][0-9][0-9][0-9])-([0-9][0-9]?)-([0-9][0-9]?)(?:[Tt]|[ \\t]+)([0-9][0-9]?):([0-9][0-9]):([0-9][0-9])(?:\\.([0-9]*))?(?:[ \\t]*(Z|([-+])([0-9][0-9]?)(?::([0-9][0-9]))?))?$"
  );
  function resolveYamlTimestamp(data) {
    if (data === null) return false;
    if (YAML_DATE_REGEXP.exec(data) !== null) return true;
    if (YAML_TIMESTAMP_REGEXP.exec(data) !== null) return true;
    return false;
  }
  function constructYamlTimestamp(data) {
    let fraction = 0;
    let delta = null;
    let match = YAML_DATE_REGEXP.exec(data);
    if (match === null) match = YAML_TIMESTAMP_REGEXP.exec(data);
    if (match === null) throw new Error("Date resolve error");
    const year = +match[1];
    const month = +match[2] - 1;
    const day = +match[3];
    if (!match[4]) {
      return new Date(Date.UTC(year, month, day));
    }
    const hour = +match[4];
    const minute = +match[5];
    const second = +match[6];
    if (match[7]) {
      fraction = match[7].slice(0, 3);
      while (fraction.length < 3) {
        fraction += "0";
      }
      fraction = +fraction;
    }
    if (match[9]) {
      const tzHour = +match[10];
      const tzMinute = +(match[11] || 0);
      delta = (tzHour * 60 + tzMinute) * 6e4;
      if (match[9] === "-") delta = -delta;
    }
    const date = new Date(Date.UTC(year, month, day, hour, minute, second, fraction));
    if (delta) date.setTime(date.getTime() - delta);
    return date;
  }
  function representYamlTimestamp(object) {
    return object.toISOString();
  }
  timestamp = new Type2("tag:yaml.org,2002:timestamp", {
    kind: "scalar",
    resolve: resolveYamlTimestamp,
    construct: constructYamlTimestamp,
    instanceOf: Date,
    represent: representYamlTimestamp
  });
  return timestamp;
}
var merge;
var hasRequiredMerge;
function requireMerge() {
  if (hasRequiredMerge) return merge;
  hasRequiredMerge = 1;
  const Type2 = requireType();
  function resolveYamlMerge(data) {
    return data === "<<" || data === null;
  }
  merge = new Type2("tag:yaml.org,2002:merge", {
    kind: "scalar",
    resolve: resolveYamlMerge
  });
  return merge;
}
var binary;
var hasRequiredBinary;
function requireBinary() {
  if (hasRequiredBinary) return binary;
  hasRequiredBinary = 1;
  const Type2 = requireType();
  const BASE64_MAP = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=\n\r";
  function resolveYamlBinary(data) {
    if (data === null) return false;
    let bitlen = 0;
    const max = data.length;
    const map2 = BASE64_MAP;
    for (let idx = 0; idx < max; idx++) {
      const code = map2.indexOf(data.charAt(idx));
      if (code > 64) continue;
      if (code < 0) return false;
      bitlen += 6;
    }
    return bitlen % 8 === 0;
  }
  function constructYamlBinary(data) {
    const input = data.replace(/[\r\n=]/g, "");
    const max = input.length;
    const map2 = BASE64_MAP;
    let bits = 0;
    const result = [];
    for (let idx = 0; idx < max; idx++) {
      if (idx % 4 === 0 && idx) {
        result.push(bits >> 16 & 255);
        result.push(bits >> 8 & 255);
        result.push(bits & 255);
      }
      bits = bits << 6 | map2.indexOf(input.charAt(idx));
    }
    const tailbits = max % 4 * 6;
    if (tailbits === 0) {
      result.push(bits >> 16 & 255);
      result.push(bits >> 8 & 255);
      result.push(bits & 255);
    } else if (tailbits === 18) {
      result.push(bits >> 10 & 255);
      result.push(bits >> 2 & 255);
    } else if (tailbits === 12) {
      result.push(bits >> 4 & 255);
    }
    return new Uint8Array(result);
  }
  function representYamlBinary(object) {
    let result = "";
    let bits = 0;
    const max = object.length;
    const map2 = BASE64_MAP;
    for (let idx = 0; idx < max; idx++) {
      if (idx % 3 === 0 && idx) {
        result += map2[bits >> 18 & 63];
        result += map2[bits >> 12 & 63];
        result += map2[bits >> 6 & 63];
        result += map2[bits & 63];
      }
      bits = (bits << 8) + object[idx];
    }
    const tail = max % 3;
    if (tail === 0) {
      result += map2[bits >> 18 & 63];
      result += map2[bits >> 12 & 63];
      result += map2[bits >> 6 & 63];
      result += map2[bits & 63];
    } else if (tail === 2) {
      result += map2[bits >> 10 & 63];
      result += map2[bits >> 4 & 63];
      result += map2[bits << 2 & 63];
      result += map2[64];
    } else if (tail === 1) {
      result += map2[bits >> 2 & 63];
      result += map2[bits << 4 & 63];
      result += map2[64];
      result += map2[64];
    }
    return result;
  }
  function isBinary(obj) {
    return Object.prototype.toString.call(obj) === "[object Uint8Array]";
  }
  binary = new Type2("tag:yaml.org,2002:binary", {
    kind: "scalar",
    resolve: resolveYamlBinary,
    construct: constructYamlBinary,
    predicate: isBinary,
    represent: representYamlBinary
  });
  return binary;
}
var omap;
var hasRequiredOmap;
function requireOmap() {
  if (hasRequiredOmap) return omap;
  hasRequiredOmap = 1;
  const Type2 = requireType();
  const _hasOwnProperty = Object.prototype.hasOwnProperty;
  const _toString = Object.prototype.toString;
  function resolveYamlOmap(data) {
    if (data === null) return true;
    const objectKeys = {};
    const object = data;
    for (let index = 0, length = object.length; index < length; index += 1) {
      const pair = object[index];
      let pairHasKey = false;
      if (_toString.call(pair) !== "[object Object]") return false;
      let pairKey;
      for (pairKey in pair) {
        if (_hasOwnProperty.call(pair, pairKey)) {
          if (!pairHasKey) pairHasKey = true;
          else return false;
        }
      }
      if (!pairHasKey) return false;
      if (_hasOwnProperty.call(objectKeys, pairKey)) return false;
      Object.defineProperty(objectKeys, pairKey, { value: true });
    }
    return true;
  }
  function constructYamlOmap(data) {
    return data !== null ? data : [];
  }
  omap = new Type2("tag:yaml.org,2002:omap", {
    kind: "sequence",
    resolve: resolveYamlOmap,
    construct: constructYamlOmap
  });
  return omap;
}
var pairs;
var hasRequiredPairs;
function requirePairs() {
  if (hasRequiredPairs) return pairs;
  hasRequiredPairs = 1;
  const Type2 = requireType();
  const _toString = Object.prototype.toString;
  function resolveYamlPairs(data) {
    if (data === null) return true;
    const object = data;
    const result = new Array(object.length);
    for (let index = 0, length = object.length; index < length; index += 1) {
      const pair = object[index];
      if (_toString.call(pair) !== "[object Object]") return false;
      const keys = Object.keys(pair);
      if (keys.length !== 1) return false;
      result[index] = [keys[0], pair[keys[0]]];
    }
    return true;
  }
  function constructYamlPairs(data) {
    if (data === null) return [];
    const object = data;
    const result = new Array(object.length);
    for (let index = 0, length = object.length; index < length; index += 1) {
      const pair = object[index];
      const keys = Object.keys(pair);
      result[index] = [keys[0], pair[keys[0]]];
    }
    return result;
  }
  pairs = new Type2("tag:yaml.org,2002:pairs", {
    kind: "sequence",
    resolve: resolveYamlPairs,
    construct: constructYamlPairs
  });
  return pairs;
}
var set;
var hasRequiredSet;
function requireSet() {
  if (hasRequiredSet) return set;
  hasRequiredSet = 1;
  const Type2 = requireType();
  const _hasOwnProperty = Object.prototype.hasOwnProperty;
  function resolveYamlSet(data) {
    if (data === null) return true;
    const object = data;
    for (const key in object) {
      if (_hasOwnProperty.call(object, key)) {
        if (object[key] !== null) return false;
      }
    }
    return true;
  }
  function constructYamlSet(data) {
    return data !== null ? data : {};
  }
  set = new Type2("tag:yaml.org,2002:set", {
    kind: "mapping",
    resolve: resolveYamlSet,
    construct: constructYamlSet
  });
  return set;
}
var _default;
var hasRequired_default;
function require_default() {
  if (hasRequired_default) return _default;
  hasRequired_default = 1;
  _default = requireCore().extend({
    implicit: [
      requireTimestamp(),
      requireMerge()
    ],
    explicit: [
      requireBinary(),
      requireOmap(),
      requirePairs(),
      requireSet()
    ]
  });
  return _default;
}
var hasRequiredLoader;
function requireLoader() {
  if (hasRequiredLoader) return loader;
  hasRequiredLoader = 1;
  const common2 = requireCommon();
  const YAMLException2 = requireException();
  const makeSnippet = requireSnippet();
  const DEFAULT_SCHEMA2 = require_default();
  const _hasOwnProperty = Object.prototype.hasOwnProperty;
  const CONTEXT_FLOW_IN = 1;
  const CONTEXT_FLOW_OUT = 2;
  const CONTEXT_BLOCK_IN = 3;
  const CONTEXT_BLOCK_OUT = 4;
  const CHOMPING_CLIP = 1;
  const CHOMPING_STRIP = 2;
  const CHOMPING_KEEP = 3;
  const PATTERN_NON_PRINTABLE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/;
  const PATTERN_NON_ASCII_LINE_BREAKS = /[\x85\u2028\u2029]/;
  const PATTERN_FLOW_INDICATORS = /[,\[\]{}]/;
  const PATTERN_TAG_HANDLE = /^(?:!|!!|![0-9A-Za-z-]+!)$/;
  const PATTERN_TAG_URI = /^(?:!|[^,\[\]{}])(?:%[0-9a-f]{2}|[0-9a-z\-#;/?:@&=+$,_.!~*'()\[\]])*$/i;
  function _class(obj) {
    return Object.prototype.toString.call(obj);
  }
  function isEol(c2) {
    return c2 === 10 || c2 === 13;
  }
  function isWhiteSpace(c2) {
    return c2 === 9 || c2 === 32;
  }
  function isWsOrEol(c2) {
    return c2 === 9 || c2 === 32 || c2 === 10 || c2 === 13;
  }
  function isFlowIndicator(c2) {
    return c2 === 44 || c2 === 91 || c2 === 93 || c2 === 123 || c2 === 125;
  }
  function fromHexCode(c2) {
    if (c2 >= 48 && c2 <= 57) {
      return c2 - 48;
    }
    const lc = c2 | 32;
    if (lc >= 97 && lc <= 102) {
      return lc - 97 + 10;
    }
    return -1;
  }
  function escapedHexLen(c2) {
    if (c2 === 120) {
      return 2;
    }
    if (c2 === 117) {
      return 4;
    }
    if (c2 === 85) {
      return 8;
    }
    return 0;
  }
  function fromDecimalCode(c2) {
    if (c2 >= 48 && c2 <= 57) {
      return c2 - 48;
    }
    return -1;
  }
  function simpleEscapeSequence(c2) {
    switch (c2) {
      case 48:
        return "\0";
      case 97:
        return "\x07";
      case 98:
        return "\b";
      case 116:
        return "	";
      case 9:
        return "	";
      case 110:
        return "\n";
      case 118:
        return "\v";
      case 102:
        return "\f";
      case 114:
        return "\r";
      case 101:
        return "\x1B";
      case 32:
        return " ";
      case 34:
        return '"';
      case 47:
        return "/";
      case 92:
        return "\\";
      case 78:
        return "\x85";
      case 95:
        return "\xA0";
      case 76:
        return "\u2028";
      case 80:
        return "\u2029";
      default:
        return "";
    }
  }
  function charFromCodepoint(c2) {
    if (c2 <= 65535) {
      return String.fromCharCode(c2);
    }
    return String.fromCharCode(
      (c2 - 65536 >> 10) + 55296,
      (c2 - 65536 & 1023) + 56320
    );
  }
  function setProperty(object, key, value) {
    if (key === "__proto__") {
      Object.defineProperty(object, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value
      });
    } else {
      object[key] = value;
    }
  }
  const simpleEscapeCheck = new Array(256);
  const simpleEscapeMap = new Array(256);
  for (let i2 = 0; i2 < 256; i2++) {
    simpleEscapeCheck[i2] = simpleEscapeSequence(i2) ? 1 : 0;
    simpleEscapeMap[i2] = simpleEscapeSequence(i2);
  }
  function State(input, options) {
    this.input = input;
    this.filename = options["filename"] || null;
    this.schema = options["schema"] || DEFAULT_SCHEMA2;
    this.onWarning = options["onWarning"] || null;
    this.legacy = options["legacy"] || false;
    this.json = options["json"] || false;
    this.listener = options["listener"] || null;
    this.maxDepth = typeof options["maxDepth"] === "number" ? options["maxDepth"] : 100;
    this.maxTotalMergeKeys = typeof options["maxTotalMergeKeys"] === "number" ? options["maxTotalMergeKeys"] : 1e4;
    this.implicitTypes = this.schema.compiledImplicit;
    this.typeMap = this.schema.compiledTypeMap;
    this.length = input.length;
    this.position = 0;
    this.line = 0;
    this.lineStart = 0;
    this.lineIndent = 0;
    this.depth = 0;
    this.totalMergeKeys = 0;
    this.firstTabInLine = -1;
    this.documents = [];
    this.anchorMapTransactions = [];
  }
  function generateError(state, message) {
    const mark = {
      name: state.filename,
      buffer: state.input.slice(0, -1),
      // omit trailing \0
      position: state.position,
      line: state.line,
      column: state.position - state.lineStart
    };
    mark.snippet = makeSnippet(mark);
    return new YAMLException2(message, mark);
  }
  function throwError(state, message) {
    throw generateError(state, message);
  }
  function throwWarning(state, message) {
    if (state.onWarning) {
      state.onWarning.call(null, generateError(state, message));
    }
  }
  function storeAnchor(state, name, value) {
    const transactions = state.anchorMapTransactions;
    if (transactions.length !== 0) {
      const transaction = transactions[transactions.length - 1];
      if (!_hasOwnProperty.call(transaction, name)) {
        transaction[name] = {
          existed: _hasOwnProperty.call(state.anchorMap, name),
          value: state.anchorMap[name]
        };
      }
    }
    state.anchorMap[name] = value;
  }
  function beginAnchorTransaction(state) {
    state.anchorMapTransactions.push(/* @__PURE__ */ Object.create(null));
  }
  function commitAnchorTransaction(state) {
    const transaction = state.anchorMapTransactions.pop();
    const transactions = state.anchorMapTransactions;
    if (transactions.length === 0) return;
    const parent = transactions[transactions.length - 1];
    const names = Object.keys(transaction);
    for (let index = 0, length = names.length; index < length; index += 1) {
      const name = names[index];
      if (!_hasOwnProperty.call(parent, name)) {
        parent[name] = transaction[name];
      }
    }
  }
  function rollbackAnchorTransaction(state) {
    const transaction = state.anchorMapTransactions.pop();
    const names = Object.keys(transaction);
    for (let index = names.length - 1; index >= 0; index -= 1) {
      const entry = transaction[names[index]];
      if (entry.existed) {
        state.anchorMap[names[index]] = entry.value;
      } else {
        delete state.anchorMap[names[index]];
      }
    }
  }
  function snapshotState(state) {
    return {
      position: state.position,
      line: state.line,
      lineStart: state.lineStart,
      lineIndent: state.lineIndent,
      firstTabInLine: state.firstTabInLine,
      tag: state.tag,
      anchor: state.anchor,
      kind: state.kind,
      result: state.result
    };
  }
  function restoreState(state, snapshot) {
    state.position = snapshot.position;
    state.line = snapshot.line;
    state.lineStart = snapshot.lineStart;
    state.lineIndent = snapshot.lineIndent;
    state.firstTabInLine = snapshot.firstTabInLine;
    state.tag = snapshot.tag;
    state.anchor = snapshot.anchor;
    state.kind = snapshot.kind;
    state.result = snapshot.result;
  }
  const directiveHandlers = {
    YAML: function handleYamlDirective(state, name, args) {
      if (state.version !== null) {
        throwError(state, "duplication of %YAML directive");
      }
      if (args.length !== 1) {
        throwError(state, "YAML directive accepts exactly one argument");
      }
      const match = /^([0-9]+)\.([0-9]+)$/.exec(args[0]);
      if (match === null) {
        throwError(state, "ill-formed argument of the YAML directive");
      }
      const major = parseInt(match[1], 10);
      const minor = parseInt(match[2], 10);
      if (major !== 1) {
        throwError(state, "unacceptable YAML version of the document");
      }
      state.version = args[0];
      state.checkLineBreaks = minor < 2;
      if (minor !== 1 && minor !== 2) {
        throwWarning(state, "unsupported YAML version of the document");
      }
    },
    TAG: function handleTagDirective(state, name, args) {
      let prefix;
      if (args.length !== 2) {
        throwError(state, "TAG directive accepts exactly two arguments");
      }
      const handle = args[0];
      prefix = args[1];
      if (!PATTERN_TAG_HANDLE.test(handle)) {
        throwError(state, "ill-formed tag handle (first argument) of the TAG directive");
      }
      if (_hasOwnProperty.call(state.tagMap, handle)) {
        throwError(state, 'there is a previously declared suffix for "' + handle + '" tag handle');
      }
      if (!PATTERN_TAG_URI.test(prefix)) {
        throwError(state, "ill-formed tag prefix (second argument) of the TAG directive");
      }
      try {
        prefix = decodeURIComponent(prefix);
      } catch (err) {
        throwError(state, "tag prefix is malformed: " + prefix);
      }
      state.tagMap[handle] = prefix;
    }
  };
  function captureSegment(state, start, end, checkJson) {
    if (start < end) {
      const _result = state.input.slice(start, end);
      if (checkJson) {
        for (let _position = 0, _length = _result.length; _position < _length; _position += 1) {
          const _character = _result.charCodeAt(_position);
          if (!(_character === 9 || _character >= 32 && _character <= 1114111)) {
            throwError(state, "expected valid JSON character");
          }
        }
      } else if (PATTERN_NON_PRINTABLE.test(_result)) {
        throwError(state, "the stream contains non-printable characters");
      }
      state.result += _result;
    }
  }
  function chargeMergeWork(state) {
    state.totalMergeKeys++;
    if (state.maxTotalMergeKeys !== -1 && state.totalMergeKeys > state.maxTotalMergeKeys) {
      throwError(state, "merge keys exceeded maxTotalMergeKeys (" + state.maxTotalMergeKeys + ")");
    }
  }
  function mergeMappings(state, destination, source, overridableKeys) {
    if (!common2.isObject(source)) {
      throwError(state, "cannot merge mappings; the provided source object is unacceptable");
    }
    chargeMergeWork(state);
    const sourceKeys = Object.keys(source);
    for (let index = 0, quantity = sourceKeys.length; index < quantity; index += 1) {
      const key = sourceKeys[index];
      chargeMergeWork(state);
      if (!_hasOwnProperty.call(destination, key)) {
        setProperty(destination, key, source[key]);
        overridableKeys[key] = true;
      }
    }
  }
  function storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, startLine, startLineStart, startPos) {
    if (Array.isArray(keyNode)) {
      keyNode = Array.prototype.slice.call(keyNode);
      for (let index = 0, quantity = keyNode.length; index < quantity; index += 1) {
        if (Array.isArray(keyNode[index])) {
          throwError(state, "nested arrays are not supported inside keys");
        }
        if (typeof keyNode === "object" && _class(keyNode[index]) === "[object Object]") {
          keyNode[index] = "[object Object]";
        }
      }
    }
    if (typeof keyNode === "object" && _class(keyNode) === "[object Object]") {
      keyNode = "[object Object]";
    }
    keyNode = String(keyNode);
    if (_result === null) {
      _result = {};
    }
    if (keyTag === "tag:yaml.org,2002:merge") {
      if (Array.isArray(valueNode)) {
        if (valueNode.length > 100) {
          throwError(state, "abnormal merge sequence size");
        }
        for (let index = 0, quantity = valueNode.length; index < quantity; index += 1) {
          mergeMappings(state, _result, valueNode[index], overridableKeys);
        }
      } else {
        mergeMappings(state, _result, valueNode, overridableKeys);
      }
    } else {
      if (!state.json && !_hasOwnProperty.call(overridableKeys, keyNode) && _hasOwnProperty.call(_result, keyNode)) {
        state.line = startLine || state.line;
        state.lineStart = startLineStart || state.lineStart;
        state.position = startPos || state.position;
        throwError(state, "duplicated mapping key");
      }
      setProperty(_result, keyNode, valueNode);
      delete overridableKeys[keyNode];
    }
    return _result;
  }
  function readLineBreak(state) {
    const ch = state.input.charCodeAt(state.position);
    if (ch === 10) {
      state.position++;
    } else if (ch === 13) {
      state.position++;
      if (state.input.charCodeAt(state.position) === 10) {
        state.position++;
      }
    } else {
      throwError(state, "a line break is expected");
    }
    state.line += 1;
    state.lineStart = state.position;
    state.firstTabInLine = -1;
  }
  function skipSeparationSpace(state, allowComments, checkIndent) {
    let lineBreaks = 0;
    let ch = state.input.charCodeAt(state.position);
    while (ch !== 0) {
      while (isWhiteSpace(ch)) {
        if (ch === 9 && state.firstTabInLine === -1) {
          state.firstTabInLine = state.position;
        }
        ch = state.input.charCodeAt(++state.position);
      }
      if (allowComments && ch === 35) {
        do {
          ch = state.input.charCodeAt(++state.position);
        } while (ch !== 10 && ch !== 13 && ch !== 0);
      }
      if (isEol(ch)) {
        readLineBreak(state);
        ch = state.input.charCodeAt(state.position);
        lineBreaks++;
        state.lineIndent = 0;
        while (ch === 32) {
          state.lineIndent++;
          ch = state.input.charCodeAt(++state.position);
        }
      } else {
        break;
      }
    }
    if (checkIndent !== -1 && lineBreaks !== 0 && state.lineIndent < checkIndent) {
      throwWarning(state, "deficient indentation");
    }
    return lineBreaks;
  }
  function testDocumentSeparator(state) {
    let _position = state.position;
    let ch = state.input.charCodeAt(_position);
    if ((ch === 45 || ch === 46) && ch === state.input.charCodeAt(_position + 1) && ch === state.input.charCodeAt(_position + 2)) {
      _position += 3;
      ch = state.input.charCodeAt(_position);
      if (ch === 0 || isWsOrEol(ch)) {
        return true;
      }
    }
    return false;
  }
  function writeFoldedLines(state, count2) {
    if (count2 === 1) {
      state.result += " ";
    } else if (count2 > 1) {
      state.result += common2.repeat("\n", count2 - 1);
    }
  }
  function readPlainScalar(state, nodeIndent, withinFlowCollection) {
    let captureStart;
    let captureEnd;
    let hasPendingContent;
    let _line;
    let _lineStart;
    let _lineIndent;
    const _kind = state.kind;
    const _result = state.result;
    let ch = state.input.charCodeAt(state.position);
    if (isWsOrEol(ch) || isFlowIndicator(ch) || ch === 35 || ch === 38 || ch === 42 || ch === 33 || ch === 124 || ch === 62 || ch === 39 || ch === 34 || ch === 37 || ch === 64 || ch === 96) {
      return false;
    }
    if (ch === 63 || ch === 45) {
      const following = state.input.charCodeAt(state.position + 1);
      if (isWsOrEol(following) || withinFlowCollection && isFlowIndicator(following)) {
        return false;
      }
    }
    state.kind = "scalar";
    state.result = "";
    captureStart = captureEnd = state.position;
    hasPendingContent = false;
    while (ch !== 0) {
      if (ch === 58) {
        const following = state.input.charCodeAt(state.position + 1);
        if (isWsOrEol(following) || withinFlowCollection && isFlowIndicator(following)) {
          break;
        }
      } else if (ch === 35) {
        const preceding = state.input.charCodeAt(state.position - 1);
        if (isWsOrEol(preceding)) {
          break;
        }
      } else if (state.position === state.lineStart && testDocumentSeparator(state) || withinFlowCollection && isFlowIndicator(ch)) {
        break;
      } else if (isEol(ch)) {
        _line = state.line;
        _lineStart = state.lineStart;
        _lineIndent = state.lineIndent;
        skipSeparationSpace(state, false, -1);
        if (state.lineIndent >= nodeIndent) {
          hasPendingContent = true;
          ch = state.input.charCodeAt(state.position);
          continue;
        } else {
          state.position = captureEnd;
          state.line = _line;
          state.lineStart = _lineStart;
          state.lineIndent = _lineIndent;
          break;
        }
      }
      if (hasPendingContent) {
        captureSegment(state, captureStart, captureEnd, false);
        writeFoldedLines(state, state.line - _line);
        captureStart = captureEnd = state.position;
        hasPendingContent = false;
      }
      if (!isWhiteSpace(ch)) {
        captureEnd = state.position + 1;
      }
      ch = state.input.charCodeAt(++state.position);
    }
    captureSegment(state, captureStart, captureEnd, false);
    if (state.result) {
      return true;
    }
    state.kind = _kind;
    state.result = _result;
    return false;
  }
  function readSingleQuotedScalar(state, nodeIndent) {
    let captureStart;
    let captureEnd;
    let ch = state.input.charCodeAt(state.position);
    if (ch !== 39) {
      return false;
    }
    state.kind = "scalar";
    state.result = "";
    state.position++;
    captureStart = captureEnd = state.position;
    while ((ch = state.input.charCodeAt(state.position)) !== 0) {
      if (ch === 39) {
        captureSegment(state, captureStart, state.position, true);
        ch = state.input.charCodeAt(++state.position);
        if (ch === 39) {
          captureStart = state.position;
          state.position++;
          captureEnd = state.position;
        } else {
          return true;
        }
      } else if (isEol(ch)) {
        captureSegment(state, captureStart, captureEnd, true);
        writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
        captureStart = captureEnd = state.position;
      } else if (state.position === state.lineStart && testDocumentSeparator(state)) {
        throwError(state, "unexpected end of the document within a single quoted scalar");
      } else {
        state.position++;
        if (!isWhiteSpace(ch)) {
          captureEnd = state.position;
        }
      }
    }
    throwError(state, "unexpected end of the stream within a single quoted scalar");
  }
  function readDoubleQuotedScalar(state, nodeIndent) {
    let captureStart;
    let captureEnd;
    let tmp;
    let ch = state.input.charCodeAt(state.position);
    if (ch !== 34) {
      return false;
    }
    state.kind = "scalar";
    state.result = "";
    state.position++;
    captureStart = captureEnd = state.position;
    while ((ch = state.input.charCodeAt(state.position)) !== 0) {
      if (ch === 34) {
        captureSegment(state, captureStart, state.position, true);
        state.position++;
        return true;
      } else if (ch === 92) {
        captureSegment(state, captureStart, state.position, true);
        ch = state.input.charCodeAt(++state.position);
        if (isEol(ch)) {
          skipSeparationSpace(state, false, nodeIndent);
        } else if (ch < 256 && simpleEscapeCheck[ch]) {
          state.result += simpleEscapeMap[ch];
          state.position++;
        } else if ((tmp = escapedHexLen(ch)) > 0) {
          let hexLength = tmp;
          let hexResult = 0;
          for (; hexLength > 0; hexLength--) {
            ch = state.input.charCodeAt(++state.position);
            if ((tmp = fromHexCode(ch)) >= 0) {
              hexResult = (hexResult << 4) + tmp;
            } else {
              throwError(state, "expected hexadecimal character");
            }
          }
          state.result += charFromCodepoint(hexResult);
          state.position++;
        } else {
          throwError(state, "unknown escape sequence");
        }
        captureStart = captureEnd = state.position;
      } else if (isEol(ch)) {
        captureSegment(state, captureStart, captureEnd, true);
        writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
        captureStart = captureEnd = state.position;
      } else if (state.position === state.lineStart && testDocumentSeparator(state)) {
        throwError(state, "unexpected end of the document within a double quoted scalar");
      } else {
        state.position++;
        if (!isWhiteSpace(ch)) {
          captureEnd = state.position;
        }
      }
    }
    throwError(state, "unexpected end of the stream within a double quoted scalar");
  }
  function readFlowCollection(state, nodeIndent) {
    let readNext = true;
    let _line;
    let _lineStart;
    let _pos;
    const _tag = state.tag;
    let _result;
    const _anchor = state.anchor;
    let terminator;
    let isPair;
    let isExplicitPair;
    let isMapping;
    const overridableKeys = /* @__PURE__ */ Object.create(null);
    let keyNode;
    let keyTag;
    let valueNode;
    let ch = state.input.charCodeAt(state.position);
    if (ch === 91) {
      terminator = 93;
      isMapping = false;
      _result = [];
    } else if (ch === 123) {
      terminator = 125;
      isMapping = true;
      _result = {};
    } else {
      return false;
    }
    if (state.anchor !== null) {
      storeAnchor(state, state.anchor, _result);
    }
    ch = state.input.charCodeAt(++state.position);
    while (ch !== 0) {
      skipSeparationSpace(state, true, nodeIndent);
      ch = state.input.charCodeAt(state.position);
      if (ch === terminator) {
        state.position++;
        state.tag = _tag;
        state.anchor = _anchor;
        state.kind = isMapping ? "mapping" : "sequence";
        state.result = _result;
        return true;
      } else if (!readNext) {
        throwError(state, "missed comma between flow collection entries");
      } else if (ch === 44) {
        throwError(state, "expected the node content, but found ','");
      }
      keyTag = keyNode = valueNode = null;
      isPair = isExplicitPair = false;
      if (ch === 63) {
        const following = state.input.charCodeAt(state.position + 1);
        if (isWsOrEol(following)) {
          isPair = isExplicitPair = true;
          state.position++;
          skipSeparationSpace(state, true, nodeIndent);
        }
      }
      _line = state.line;
      _lineStart = state.lineStart;
      _pos = state.position;
      composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
      keyTag = state.tag;
      keyNode = state.result;
      skipSeparationSpace(state, true, nodeIndent);
      ch = state.input.charCodeAt(state.position);
      if ((isExplicitPair || state.line === _line) && ch === 58) {
        isPair = true;
        ch = state.input.charCodeAt(++state.position);
        skipSeparationSpace(state, true, nodeIndent);
        composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
        valueNode = state.result;
      }
      if (isMapping) {
        storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos);
      } else if (isPair) {
        _result.push(storeMappingPair(state, null, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos));
      } else {
        _result.push(keyNode);
      }
      skipSeparationSpace(state, true, nodeIndent);
      ch = state.input.charCodeAt(state.position);
      if (ch === 44) {
        readNext = true;
        ch = state.input.charCodeAt(++state.position);
      } else {
        readNext = false;
      }
    }
    throwError(state, "unexpected end of the stream within a flow collection");
  }
  function readBlockScalar(state, nodeIndent) {
    let folding;
    let chomping = CHOMPING_CLIP;
    let didReadContent = false;
    let detectedIndent = false;
    let textIndent = nodeIndent;
    let emptyLines = 0;
    let atMoreIndented = false;
    let tmp;
    let ch = state.input.charCodeAt(state.position);
    if (ch === 124) {
      folding = false;
    } else if (ch === 62) {
      folding = true;
    } else {
      return false;
    }
    state.kind = "scalar";
    state.result = "";
    while (ch !== 0) {
      ch = state.input.charCodeAt(++state.position);
      if (ch === 43 || ch === 45) {
        if (CHOMPING_CLIP === chomping) {
          chomping = ch === 43 ? CHOMPING_KEEP : CHOMPING_STRIP;
        } else {
          throwError(state, "repeat of a chomping mode identifier");
        }
      } else if ((tmp = fromDecimalCode(ch)) >= 0) {
        if (tmp === 0) {
          throwError(state, "bad explicit indentation width of a block scalar; it cannot be less than one");
        } else if (!detectedIndent) {
          textIndent = nodeIndent + tmp - 1;
          detectedIndent = true;
        } else {
          throwError(state, "repeat of an indentation width identifier");
        }
      } else {
        break;
      }
    }
    if (isWhiteSpace(ch)) {
      do {
        ch = state.input.charCodeAt(++state.position);
      } while (isWhiteSpace(ch));
      if (ch === 35) {
        do {
          ch = state.input.charCodeAt(++state.position);
        } while (!isEol(ch) && ch !== 0);
      }
    }
    while (ch !== 0) {
      readLineBreak(state);
      state.lineIndent = 0;
      ch = state.input.charCodeAt(state.position);
      while ((!detectedIndent || state.lineIndent < textIndent) && ch === 32) {
        state.lineIndent++;
        ch = state.input.charCodeAt(++state.position);
      }
      if (!detectedIndent && state.lineIndent > textIndent) {
        textIndent = state.lineIndent;
      }
      if (isEol(ch)) {
        emptyLines++;
        continue;
      }
      if (!detectedIndent && textIndent === 0) {
        throwError(state, "missing indentation for block scalar");
      }
      if (state.lineIndent < textIndent) {
        if (chomping === CHOMPING_KEEP) {
          state.result += common2.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
        } else if (chomping === CHOMPING_CLIP) {
          if (didReadContent) {
            state.result += "\n";
          }
        }
        break;
      }
      if (folding) {
        if (isWhiteSpace(ch)) {
          atMoreIndented = true;
          state.result += common2.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
        } else if (atMoreIndented) {
          atMoreIndented = false;
          state.result += common2.repeat("\n", emptyLines + 1);
        } else if (emptyLines === 0) {
          if (didReadContent) {
            state.result += " ";
          }
        } else {
          state.result += common2.repeat("\n", emptyLines);
        }
      } else {
        state.result += common2.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
      }
      didReadContent = true;
      detectedIndent = true;
      emptyLines = 0;
      const captureStart = state.position;
      while (!isEol(ch) && ch !== 0) {
        ch = state.input.charCodeAt(++state.position);
      }
      captureSegment(state, captureStart, state.position, false);
    }
    return true;
  }
  function readBlockSequence(state, nodeIndent) {
    const _tag = state.tag;
    const _anchor = state.anchor;
    const _result = [];
    let detected = false;
    if (state.firstTabInLine !== -1) return false;
    if (state.anchor !== null) {
      storeAnchor(state, state.anchor, _result);
    }
    let ch = state.input.charCodeAt(state.position);
    while (ch !== 0) {
      if (state.firstTabInLine !== -1) {
        state.position = state.firstTabInLine;
        throwError(state, "tab characters must not be used in indentation");
      }
      if (ch !== 45) {
        break;
      }
      const following = state.input.charCodeAt(state.position + 1);
      if (!isWsOrEol(following)) {
        break;
      }
      detected = true;
      state.position++;
      if (skipSeparationSpace(state, true, -1)) {
        if (state.lineIndent <= nodeIndent) {
          _result.push(null);
          ch = state.input.charCodeAt(state.position);
          continue;
        }
      }
      const _line = state.line;
      composeNode(state, nodeIndent, CONTEXT_BLOCK_IN, false, true);
      _result.push(state.result);
      skipSeparationSpace(state, true, -1);
      ch = state.input.charCodeAt(state.position);
      if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0) {
        throwError(state, "bad indentation of a sequence entry");
      } else if (state.lineIndent < nodeIndent) {
        break;
      }
    }
    if (detected) {
      state.tag = _tag;
      state.anchor = _anchor;
      state.kind = "sequence";
      state.result = _result;
      return true;
    }
    return false;
  }
  function readBlockMapping(state, nodeIndent, flowIndent) {
    let allowCompact;
    let _keyLine;
    let _keyLineStart;
    let _keyPos;
    const _tag = state.tag;
    const _anchor = state.anchor;
    const _result = {};
    const overridableKeys = /* @__PURE__ */ Object.create(null);
    let keyTag = null;
    let keyNode = null;
    let valueNode = null;
    let atExplicitKey = false;
    let detected = false;
    if (state.firstTabInLine !== -1) return false;
    if (state.anchor !== null) {
      storeAnchor(state, state.anchor, _result);
    }
    let ch = state.input.charCodeAt(state.position);
    while (ch !== 0) {
      if (!atExplicitKey && state.firstTabInLine !== -1) {
        state.position = state.firstTabInLine;
        throwError(state, "tab characters must not be used in indentation");
      }
      const following = state.input.charCodeAt(state.position + 1);
      const _line = state.line;
      if ((ch === 63 || ch === 58) && isWsOrEol(following)) {
        if (ch === 63) {
          if (atExplicitKey) {
            storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
            keyTag = keyNode = valueNode = null;
          }
          detected = true;
          atExplicitKey = true;
          allowCompact = true;
        } else if (atExplicitKey) {
          atExplicitKey = false;
          allowCompact = true;
        } else {
          throwError(state, "incomplete explicit mapping pair; a key node is missed; or followed by a non-tabulated empty line");
        }
        state.position += 1;
        ch = following;
      } else {
        _keyLine = state.line;
        _keyLineStart = state.lineStart;
        _keyPos = state.position;
        if (!composeNode(state, flowIndent, CONTEXT_FLOW_OUT, false, true)) {
          break;
        }
        if (state.line === _line) {
          ch = state.input.charCodeAt(state.position);
          while (isWhiteSpace(ch)) {
            ch = state.input.charCodeAt(++state.position);
          }
          if (ch === 58) {
            ch = state.input.charCodeAt(++state.position);
            if (!isWsOrEol(ch)) {
              throwError(state, "a whitespace character is expected after the key-value separator within a block mapping");
            }
            if (atExplicitKey) {
              storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
              keyTag = keyNode = valueNode = null;
            }
            detected = true;
            atExplicitKey = false;
            allowCompact = false;
            keyTag = state.tag;
            keyNode = state.result;
          } else if (detected) {
            throwError(state, "can not read an implicit mapping pair; a colon is missed");
          } else {
            state.tag = _tag;
            state.anchor = _anchor;
            return true;
          }
        } else if (detected) {
          throwError(state, "can not read a block mapping entry; a multiline key may not be an implicit key");
        } else {
          state.tag = _tag;
          state.anchor = _anchor;
          return true;
        }
      }
      if (state.line === _line || state.lineIndent > nodeIndent) {
        if (atExplicitKey) {
          _keyLine = state.line;
          _keyLineStart = state.lineStart;
          _keyPos = state.position;
        }
        if (composeNode(state, nodeIndent, CONTEXT_BLOCK_OUT, true, allowCompact)) {
          if (atExplicitKey) {
            keyNode = state.result;
          } else {
            valueNode = state.result;
          }
        }
        if (!atExplicitKey) {
          storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _keyLine, _keyLineStart, _keyPos);
          keyTag = keyNode = valueNode = null;
        }
        skipSeparationSpace(state, true, -1);
        ch = state.input.charCodeAt(state.position);
      }
      if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0) {
        throwError(state, "bad indentation of a mapping entry");
      } else if (state.lineIndent < nodeIndent) {
        break;
      }
    }
    if (atExplicitKey) {
      storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
    }
    if (detected) {
      state.tag = _tag;
      state.anchor = _anchor;
      state.kind = "mapping";
      state.result = _result;
    }
    return detected;
  }
  function readTagProperty(state) {
    let isVerbatim = false;
    let isNamed = false;
    let tagHandle;
    let tagName;
    let ch = state.input.charCodeAt(state.position);
    if (ch !== 33) return false;
    if (state.tag !== null) {
      throwError(state, "duplication of a tag property");
    }
    ch = state.input.charCodeAt(++state.position);
    if (ch === 60) {
      isVerbatim = true;
      ch = state.input.charCodeAt(++state.position);
    } else if (ch === 33) {
      isNamed = true;
      tagHandle = "!!";
      ch = state.input.charCodeAt(++state.position);
    } else {
      tagHandle = "!";
    }
    let _position = state.position;
    if (isVerbatim) {
      do {
        ch = state.input.charCodeAt(++state.position);
      } while (ch !== 0 && ch !== 62);
      if (state.position < state.length) {
        tagName = state.input.slice(_position, state.position);
        ch = state.input.charCodeAt(++state.position);
      } else {
        throwError(state, "unexpected end of the stream within a verbatim tag");
      }
    } else {
      while (ch !== 0 && !isWsOrEol(ch)) {
        if (ch === 33) {
          if (!isNamed) {
            tagHandle = state.input.slice(_position - 1, state.position + 1);
            if (!PATTERN_TAG_HANDLE.test(tagHandle)) {
              throwError(state, "named tag handle cannot contain such characters");
            }
            isNamed = true;
            _position = state.position + 1;
          } else {
            throwError(state, "tag suffix cannot contain exclamation marks");
          }
        }
        ch = state.input.charCodeAt(++state.position);
      }
      tagName = state.input.slice(_position, state.position);
      if (PATTERN_FLOW_INDICATORS.test(tagName)) {
        throwError(state, "tag suffix cannot contain flow indicator characters");
      }
    }
    if (tagName && !PATTERN_TAG_URI.test(tagName)) {
      throwError(state, "tag name cannot contain such characters: " + tagName);
    }
    try {
      tagName = decodeURIComponent(tagName);
    } catch (err) {
      throwError(state, "tag name is malformed: " + tagName);
    }
    if (isVerbatim) {
      state.tag = tagName;
    } else if (_hasOwnProperty.call(state.tagMap, tagHandle)) {
      state.tag = state.tagMap[tagHandle] + tagName;
    } else if (tagHandle === "!") {
      state.tag = "!" + tagName;
    } else if (tagHandle === "!!") {
      state.tag = "tag:yaml.org,2002:" + tagName;
    } else {
      throwError(state, 'undeclared tag handle "' + tagHandle + '"');
    }
    return true;
  }
  function readAnchorProperty(state) {
    let ch = state.input.charCodeAt(state.position);
    if (ch !== 38) return false;
    if (state.anchor !== null) {
      throwError(state, "duplication of an anchor property");
    }
    ch = state.input.charCodeAt(++state.position);
    const _position = state.position;
    while (ch !== 0 && !isWsOrEol(ch) && !isFlowIndicator(ch)) {
      ch = state.input.charCodeAt(++state.position);
    }
    if (state.position === _position) {
      throwError(state, "name of an anchor node must contain at least one character");
    }
    state.anchor = state.input.slice(_position, state.position);
    return true;
  }
  function readAlias(state) {
    let ch = state.input.charCodeAt(state.position);
    if (ch !== 42) return false;
    ch = state.input.charCodeAt(++state.position);
    const _position = state.position;
    while (ch !== 0 && !isWsOrEol(ch) && !isFlowIndicator(ch)) {
      ch = state.input.charCodeAt(++state.position);
    }
    if (state.position === _position) {
      throwError(state, "name of an alias node must contain at least one character");
    }
    const alias = state.input.slice(_position, state.position);
    if (!_hasOwnProperty.call(state.anchorMap, alias)) {
      throwError(state, 'unidentified alias "' + alias + '"');
    }
    state.result = state.anchorMap[alias];
    skipSeparationSpace(state, true, -1);
    return true;
  }
  function tryReadBlockMappingFromProperty(state, propertyStart, nodeIndent, flowIndent) {
    const fallbackState = snapshotState(state);
    beginAnchorTransaction(state);
    restoreState(state, propertyStart);
    state.tag = null;
    state.anchor = null;
    state.kind = null;
    state.result = null;
    if (readBlockMapping(state, nodeIndent, flowIndent) && state.kind === "mapping") {
      commitAnchorTransaction(state);
      return true;
    }
    rollbackAnchorTransaction(state);
    restoreState(state, fallbackState);
    return false;
  }
  function composeNode(state, parentIndent, nodeContext, allowToSeek, allowCompact) {
    let allowBlockScalars;
    let allowBlockCollections;
    let indentStatus = 1;
    let atNewLine = false;
    let hasContent = false;
    let propertyStart = null;
    let type2;
    let flowIndent;
    let blockIndent;
    if (state.depth >= state.maxDepth) {
      throwError(state, "nesting exceeded maxDepth (" + state.maxDepth + ")");
    }
    state.depth += 1;
    if (state.listener !== null) {
      state.listener("open", state);
    }
    state.tag = null;
    state.anchor = null;
    state.kind = null;
    state.result = null;
    const allowBlockStyles = allowBlockScalars = allowBlockCollections = CONTEXT_BLOCK_OUT === nodeContext || CONTEXT_BLOCK_IN === nodeContext;
    if (allowToSeek) {
      if (skipSeparationSpace(state, true, -1)) {
        atNewLine = true;
        if (state.lineIndent > parentIndent) {
          indentStatus = 1;
        } else if (state.lineIndent === parentIndent) {
          indentStatus = 0;
        } else if (state.lineIndent < parentIndent) {
          indentStatus = -1;
        }
      }
    }
    if (indentStatus === 1) {
      while (true) {
        const ch = state.input.charCodeAt(state.position);
        const propertyState = snapshotState(state);
        if (atNewLine && (ch === 33 && state.tag !== null || ch === 38 && state.anchor !== null)) {
          break;
        }
        if (!readTagProperty(state) && !readAnchorProperty(state)) {
          break;
        }
        if (propertyStart === null) {
          propertyStart = propertyState;
        }
        if (skipSeparationSpace(state, true, -1)) {
          atNewLine = true;
          allowBlockCollections = allowBlockStyles;
          if (state.lineIndent > parentIndent) {
            indentStatus = 1;
          } else if (state.lineIndent === parentIndent) {
            indentStatus = 0;
          } else if (state.lineIndent < parentIndent) {
            indentStatus = -1;
          }
        } else {
          allowBlockCollections = false;
        }
      }
    }
    if (allowBlockCollections) {
      allowBlockCollections = atNewLine || allowCompact;
    }
    if (indentStatus === 1 || CONTEXT_BLOCK_OUT === nodeContext) {
      if (CONTEXT_FLOW_IN === nodeContext || CONTEXT_FLOW_OUT === nodeContext) {
        flowIndent = parentIndent;
      } else {
        flowIndent = parentIndent + 1;
      }
      blockIndent = state.position - state.lineStart;
      if (indentStatus === 1) {
        if (allowBlockCollections && (readBlockSequence(state, blockIndent) || readBlockMapping(state, blockIndent, flowIndent)) || readFlowCollection(state, flowIndent)) {
          hasContent = true;
        } else {
          const ch = state.input.charCodeAt(state.position);
          if (propertyStart !== null && allowBlockStyles && !allowBlockCollections && ch !== 124 && ch !== 62 && tryReadBlockMappingFromProperty(
            state,
            propertyStart,
            propertyStart.position - propertyStart.lineStart,
            flowIndent
          )) {
            hasContent = true;
          } else if (allowBlockScalars && readBlockScalar(state, flowIndent) || readSingleQuotedScalar(state, flowIndent) || readDoubleQuotedScalar(state, flowIndent)) {
            hasContent = true;
          } else if (readAlias(state)) {
            hasContent = true;
            if (state.tag !== null || state.anchor !== null) {
              throwError(state, "alias node should not have any properties");
            }
          } else if (readPlainScalar(state, flowIndent, CONTEXT_FLOW_IN === nodeContext)) {
            hasContent = true;
            if (state.tag === null) {
              state.tag = "?";
            }
          }
          if (state.anchor !== null) {
            storeAnchor(state, state.anchor, state.result);
          }
        }
      } else if (indentStatus === 0) {
        hasContent = allowBlockCollections && readBlockSequence(state, blockIndent);
      }
    }
    if (state.tag === null) {
      if (state.anchor !== null) {
        storeAnchor(state, state.anchor, state.result);
      }
    } else if (state.tag === "?") {
      if (state.result !== null && state.kind !== "scalar") {
        throwError(state, 'unacceptable node kind for !<?> tag; it should be "scalar", not "' + state.kind + '"');
      }
      for (let typeIndex = 0, typeQuantity = state.implicitTypes.length; typeIndex < typeQuantity; typeIndex += 1) {
        type2 = state.implicitTypes[typeIndex];
        if (type2.resolve(state.result)) {
          state.result = type2.construct(state.result);
          state.tag = type2.tag;
          if (state.anchor !== null) {
            storeAnchor(state, state.anchor, state.result);
          }
          break;
        }
      }
    } else if (state.tag !== "!") {
      if (_hasOwnProperty.call(state.typeMap[state.kind || "fallback"], state.tag)) {
        type2 = state.typeMap[state.kind || "fallback"][state.tag];
      } else {
        type2 = null;
        const typeList = state.typeMap.multi[state.kind || "fallback"];
        for (let typeIndex = 0, typeQuantity = typeList.length; typeIndex < typeQuantity; typeIndex += 1) {
          if (state.tag.slice(0, typeList[typeIndex].tag.length) === typeList[typeIndex].tag) {
            type2 = typeList[typeIndex];
            break;
          }
        }
      }
      if (!type2) {
        throwError(state, "unknown tag !<" + state.tag + ">");
      }
      if (state.result !== null && type2.kind !== state.kind) {
        throwError(state, "unacceptable node kind for !<" + state.tag + '> tag; it should be "' + type2.kind + '", not "' + state.kind + '"');
      }
      if (!type2.resolve(state.result, state.tag)) {
        throwError(state, "cannot resolve a node with !<" + state.tag + "> explicit tag");
      } else {
        state.result = type2.construct(state.result, state.tag);
        if (state.anchor !== null) {
          storeAnchor(state, state.anchor, state.result);
        }
      }
    }
    if (state.listener !== null) {
      state.listener("close", state);
    }
    state.depth -= 1;
    return state.tag !== null || state.anchor !== null || hasContent;
  }
  function readDocument(state) {
    const documentStart = state.position;
    let hasDirectives = false;
    let ch;
    state.version = null;
    state.checkLineBreaks = state.legacy;
    state.tagMap = /* @__PURE__ */ Object.create(null);
    state.anchorMap = /* @__PURE__ */ Object.create(null);
    while ((ch = state.input.charCodeAt(state.position)) !== 0) {
      skipSeparationSpace(state, true, -1);
      ch = state.input.charCodeAt(state.position);
      if (state.lineIndent > 0 || ch !== 37) {
        break;
      }
      hasDirectives = true;
      ch = state.input.charCodeAt(++state.position);
      let _position = state.position;
      while (ch !== 0 && !isWsOrEol(ch)) {
        ch = state.input.charCodeAt(++state.position);
      }
      const directiveName = state.input.slice(_position, state.position);
      const directiveArgs = [];
      if (directiveName.length < 1) {
        throwError(state, "directive name must not be less than one character in length");
      }
      while (ch !== 0) {
        while (isWhiteSpace(ch)) {
          ch = state.input.charCodeAt(++state.position);
        }
        if (ch === 35) {
          do {
            ch = state.input.charCodeAt(++state.position);
          } while (ch !== 0 && !isEol(ch));
          break;
        }
        if (isEol(ch)) break;
        _position = state.position;
        while (ch !== 0 && !isWsOrEol(ch)) {
          ch = state.input.charCodeAt(++state.position);
        }
        directiveArgs.push(state.input.slice(_position, state.position));
      }
      if (ch !== 0) readLineBreak(state);
      if (_hasOwnProperty.call(directiveHandlers, directiveName)) {
        directiveHandlers[directiveName](state, directiveName, directiveArgs);
      } else {
        throwWarning(state, 'unknown document directive "' + directiveName + '"');
      }
    }
    skipSeparationSpace(state, true, -1);
    if (state.lineIndent === 0 && state.input.charCodeAt(state.position) === 45 && state.input.charCodeAt(state.position + 1) === 45 && state.input.charCodeAt(state.position + 2) === 45) {
      state.position += 3;
      skipSeparationSpace(state, true, -1);
    } else if (hasDirectives) {
      throwError(state, "directives end mark is expected");
    }
    composeNode(state, state.lineIndent - 1, CONTEXT_BLOCK_OUT, false, true);
    skipSeparationSpace(state, true, -1);
    if (state.checkLineBreaks && PATTERN_NON_ASCII_LINE_BREAKS.test(state.input.slice(documentStart, state.position))) {
      throwWarning(state, "non-ASCII line breaks are interpreted as content");
    }
    state.documents.push(state.result);
    if (state.position === state.lineStart && testDocumentSeparator(state)) {
      if (state.input.charCodeAt(state.position) === 46) {
        state.position += 3;
        skipSeparationSpace(state, true, -1);
      }
      return;
    }
    if (state.position < state.length - 1) {
      throwError(state, "end of the stream or a document separator is expected");
    }
  }
  function loadDocuments(input, options) {
    input = String(input);
    options = options || {};
    if (input.length !== 0) {
      if (input.charCodeAt(input.length - 1) !== 10 && input.charCodeAt(input.length - 1) !== 13) {
        input += "\n";
      }
      if (input.charCodeAt(0) === 65279) {
        input = input.slice(1);
      }
    }
    const state = new State(input, options);
    const nullpos = input.indexOf("\0");
    if (nullpos !== -1) {
      state.position = nullpos;
      throwError(state, "null byte is not allowed in input");
    }
    state.input += "\0";
    while (state.input.charCodeAt(state.position) === 32) {
      state.lineIndent += 1;
      state.position += 1;
    }
    while (state.position < state.length - 1) {
      readDocument(state);
    }
    return state.documents;
  }
  function loadAll2(input, iterator, options) {
    if (iterator !== null && typeof iterator === "object" && typeof options === "undefined") {
      options = iterator;
      iterator = null;
    }
    const documents = loadDocuments(input, options);
    if (typeof iterator !== "function") {
      return documents;
    }
    for (let index = 0, length = documents.length; index < length; index += 1) {
      iterator(documents[index]);
    }
  }
  function load2(input, options) {
    const documents = loadDocuments(input, options);
    if (documents.length === 0) {
      return void 0;
    } else if (documents.length === 1) {
      return documents[0];
    }
    throw new YAMLException2("expected a single document in the stream, but found more");
  }
  loader.loadAll = loadAll2;
  loader.load = load2;
  return loader;
}
var dumper = {};
var hasRequiredDumper;
function requireDumper() {
  if (hasRequiredDumper) return dumper;
  hasRequiredDumper = 1;
  const common2 = requireCommon();
  const YAMLException2 = requireException();
  const DEFAULT_SCHEMA2 = require_default();
  const _toString = Object.prototype.toString;
  const _hasOwnProperty = Object.prototype.hasOwnProperty;
  const CHAR_BOM = 65279;
  const CHAR_TAB = 9;
  const CHAR_LINE_FEED = 10;
  const CHAR_CARRIAGE_RETURN = 13;
  const CHAR_SPACE = 32;
  const CHAR_EXCLAMATION = 33;
  const CHAR_DOUBLE_QUOTE = 34;
  const CHAR_SHARP = 35;
  const CHAR_PERCENT = 37;
  const CHAR_AMPERSAND = 38;
  const CHAR_SINGLE_QUOTE = 39;
  const CHAR_ASTERISK = 42;
  const CHAR_COMMA = 44;
  const CHAR_MINUS = 45;
  const CHAR_COLON = 58;
  const CHAR_EQUALS = 61;
  const CHAR_GREATER_THAN = 62;
  const CHAR_QUESTION = 63;
  const CHAR_COMMERCIAL_AT = 64;
  const CHAR_LEFT_SQUARE_BRACKET = 91;
  const CHAR_RIGHT_SQUARE_BRACKET = 93;
  const CHAR_GRAVE_ACCENT = 96;
  const CHAR_LEFT_CURLY_BRACKET = 123;
  const CHAR_VERTICAL_LINE = 124;
  const CHAR_RIGHT_CURLY_BRACKET = 125;
  const ESCAPE_SEQUENCES = {};
  ESCAPE_SEQUENCES[0] = "\\0";
  ESCAPE_SEQUENCES[7] = "\\a";
  ESCAPE_SEQUENCES[8] = "\\b";
  ESCAPE_SEQUENCES[9] = "\\t";
  ESCAPE_SEQUENCES[10] = "\\n";
  ESCAPE_SEQUENCES[11] = "\\v";
  ESCAPE_SEQUENCES[12] = "\\f";
  ESCAPE_SEQUENCES[13] = "\\r";
  ESCAPE_SEQUENCES[27] = "\\e";
  ESCAPE_SEQUENCES[34] = '\\"';
  ESCAPE_SEQUENCES[92] = "\\\\";
  ESCAPE_SEQUENCES[133] = "\\N";
  ESCAPE_SEQUENCES[160] = "\\_";
  ESCAPE_SEQUENCES[8232] = "\\L";
  ESCAPE_SEQUENCES[8233] = "\\P";
  const DEPRECATED_BOOLEANS_SYNTAX = [
    "y",
    "Y",
    "yes",
    "Yes",
    "YES",
    "on",
    "On",
    "ON",
    "n",
    "N",
    "no",
    "No",
    "NO",
    "off",
    "Off",
    "OFF"
  ];
  const DEPRECATED_BASE60_SYNTAX = /^[-+]?[0-9_]+(?::[0-9_]+)+(?:\.[0-9_]*)?$/;
  function compileStyleMap(schema2, map2) {
    if (map2 === null) return {};
    const result = {};
    const keys = Object.keys(map2);
    for (let index = 0, length = keys.length; index < length; index += 1) {
      let tag = keys[index];
      let style = String(map2[tag]);
      if (tag.slice(0, 2) === "!!") {
        tag = "tag:yaml.org,2002:" + tag.slice(2);
      }
      const type2 = schema2.compiledTypeMap["fallback"][tag];
      if (type2 && _hasOwnProperty.call(type2.styleAliases, style)) {
        style = type2.styleAliases[style];
      }
      result[tag] = style;
    }
    return result;
  }
  function encodeHex(character) {
    let handle;
    let length;
    const string = character.toString(16).toUpperCase();
    if (character <= 255) {
      handle = "x";
      length = 2;
    } else if (character <= 65535) {
      handle = "u";
      length = 4;
    } else if (character <= 4294967295) {
      handle = "U";
      length = 8;
    } else {
      throw new YAMLException2("code point within a string may not be greater than 0xFFFFFFFF");
    }
    return "\\" + handle + common2.repeat("0", length - string.length) + string;
  }
  const QUOTING_TYPE_SINGLE = 1;
  const QUOTING_TYPE_DOUBLE = 2;
  function State(options) {
    this.schema = options["schema"] || DEFAULT_SCHEMA2;
    this.indent = Math.max(1, options["indent"] || 2);
    this.noArrayIndent = options["noArrayIndent"] || false;
    this.skipInvalid = options["skipInvalid"] || false;
    this.flowLevel = common2.isNothing(options["flowLevel"]) ? -1 : options["flowLevel"];
    this.styleMap = compileStyleMap(this.schema, options["styles"] || null);
    this.sortKeys = options["sortKeys"] || false;
    this.lineWidth = options["lineWidth"] || 80;
    this.noRefs = options["noRefs"] || false;
    this.noCompatMode = options["noCompatMode"] || false;
    this.condenseFlow = options["condenseFlow"] || false;
    this.quotingType = options["quotingType"] === '"' ? QUOTING_TYPE_DOUBLE : QUOTING_TYPE_SINGLE;
    this.forceQuotes = options["forceQuotes"] || false;
    this.replacer = typeof options["replacer"] === "function" ? options["replacer"] : null;
    this.implicitTypes = this.schema.compiledImplicit;
    this.explicitTypes = this.schema.compiledExplicit;
    this.tag = null;
    this.result = "";
    this.duplicates = [];
    this.usedDuplicates = null;
  }
  function indentString(string, spaces) {
    const ind = common2.repeat(" ", spaces);
    let position = 0;
    let result = "";
    const length = string.length;
    while (position < length) {
      let line;
      const next = string.indexOf("\n", position);
      if (next === -1) {
        line = string.slice(position);
        position = length;
      } else {
        line = string.slice(position, next + 1);
        position = next + 1;
      }
      if (line.length && line !== "\n") result += ind;
      result += line;
    }
    return result;
  }
  function generateNextLine(state, level) {
    return "\n" + common2.repeat(" ", state.indent * level);
  }
  function testImplicitResolving(state, str2) {
    for (let index = 0, length = state.implicitTypes.length; index < length; index += 1) {
      const type2 = state.implicitTypes[index];
      if (type2.resolve(str2)) {
        return true;
      }
    }
    return false;
  }
  function isWhitespace(c2) {
    return c2 === CHAR_SPACE || c2 === CHAR_TAB;
  }
  function isPrintable(c2) {
    return c2 >= 32 && c2 <= 126 || c2 >= 161 && c2 <= 55295 && c2 !== 8232 && c2 !== 8233 || c2 >= 57344 && c2 <= 65533 && c2 !== CHAR_BOM || c2 >= 65536 && c2 <= 1114111;
  }
  function isNsCharOrWhitespace(c2) {
    return isPrintable(c2) && c2 !== CHAR_BOM && // - b-char
    c2 !== CHAR_CARRIAGE_RETURN && c2 !== CHAR_LINE_FEED;
  }
  function isPlainSafe(c2, prev, inblock) {
    const cIsNsCharOrWhitespace = isNsCharOrWhitespace(c2);
    const cIsNsChar = cIsNsCharOrWhitespace && !isWhitespace(c2);
    return (
      // ns-plain-safe
      (inblock ? cIsNsCharOrWhitespace : cIsNsCharOrWhitespace && // - c-flow-indicator
      c2 !== CHAR_COMMA && c2 !== CHAR_LEFT_SQUARE_BRACKET && c2 !== CHAR_RIGHT_SQUARE_BRACKET && c2 !== CHAR_LEFT_CURLY_BRACKET && c2 !== CHAR_RIGHT_CURLY_BRACKET) && // ns-plain-char
      c2 !== CHAR_SHARP && // false on '#'
      !(prev === CHAR_COLON && !cIsNsChar) || // false on ': '
      isNsCharOrWhitespace(prev) && !isWhitespace(prev) && c2 === CHAR_SHARP || // change to true on '[^ ]#'
      prev === CHAR_COLON && cIsNsChar
    );
  }
  function isPlainSafeFirst(c2) {
    return isPrintable(c2) && c2 !== CHAR_BOM && !isWhitespace(c2) && // - s-white
    // - (c-indicator ::=
    // “-” | “?” | “:” | “,” | “[” | “]” | “{” | “}”
    c2 !== CHAR_MINUS && c2 !== CHAR_QUESTION && c2 !== CHAR_COLON && c2 !== CHAR_COMMA && c2 !== CHAR_LEFT_SQUARE_BRACKET && c2 !== CHAR_RIGHT_SQUARE_BRACKET && c2 !== CHAR_LEFT_CURLY_BRACKET && c2 !== CHAR_RIGHT_CURLY_BRACKET && // | “#” | “&” | “*” | “!” | “|” | “=” | “>” | “'” | “"”
    c2 !== CHAR_SHARP && c2 !== CHAR_AMPERSAND && c2 !== CHAR_ASTERISK && c2 !== CHAR_EXCLAMATION && c2 !== CHAR_VERTICAL_LINE && c2 !== CHAR_EQUALS && c2 !== CHAR_GREATER_THAN && c2 !== CHAR_SINGLE_QUOTE && c2 !== CHAR_DOUBLE_QUOTE && // | “%” | “@” | “`”)
    c2 !== CHAR_PERCENT && c2 !== CHAR_COMMERCIAL_AT && c2 !== CHAR_GRAVE_ACCENT;
  }
  function isPlainSafeLast(c2) {
    return !isWhitespace(c2) && c2 !== CHAR_COLON;
  }
  function codePointAt(string, pos) {
    const first = string.charCodeAt(pos);
    let second;
    if (first >= 55296 && first <= 56319 && pos + 1 < string.length) {
      second = string.charCodeAt(pos + 1);
      if (second >= 56320 && second <= 57343) {
        return (first - 55296) * 1024 + second - 56320 + 65536;
      }
    }
    return first;
  }
  function needIndentIndicator(string) {
    const leadingSpaceRe = /^\n* /;
    return leadingSpaceRe.test(string);
  }
  const STYLE_PLAIN = 1;
  const STYLE_SINGLE = 2;
  const STYLE_LITERAL = 3;
  const STYLE_FOLDED = 4;
  const STYLE_DOUBLE = 5;
  function chooseScalarStyle(string, singleLineOnly, indentPerLevel, lineWidth, testAmbiguousType, quotingType, forceQuotes, inblock) {
    let i2;
    let char = 0;
    let prevChar = null;
    let hasLineBreak = false;
    let hasFoldableLine = false;
    const shouldTrackWidth = lineWidth !== -1;
    let previousLineBreak = -1;
    let plain = isPlainSafeFirst(codePointAt(string, 0)) && isPlainSafeLast(codePointAt(string, string.length - 1));
    if (singleLineOnly || forceQuotes) {
      for (i2 = 0; i2 < string.length; char >= 65536 ? i2 += 2 : i2++) {
        char = codePointAt(string, i2);
        if (!isPrintable(char)) {
          return STYLE_DOUBLE;
        }
        plain = plain && isPlainSafe(char, prevChar, inblock);
        prevChar = char;
      }
    } else {
      for (i2 = 0; i2 < string.length; char >= 65536 ? i2 += 2 : i2++) {
        char = codePointAt(string, i2);
        if (char === CHAR_LINE_FEED) {
          hasLineBreak = true;
          if (shouldTrackWidth) {
            hasFoldableLine = hasFoldableLine || // Foldable line = too long, and not more-indented.
            i2 - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ";
            previousLineBreak = i2;
          }
        } else if (!isPrintable(char)) {
          return STYLE_DOUBLE;
        }
        plain = plain && isPlainSafe(char, prevChar, inblock);
        prevChar = char;
      }
      hasFoldableLine = hasFoldableLine || shouldTrackWidth && (i2 - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ");
    }
    if (!hasLineBreak && !hasFoldableLine) {
      if (plain && !forceQuotes && !testAmbiguousType(string)) {
        return STYLE_PLAIN;
      }
      return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
    }
    if (indentPerLevel > 9 && needIndentIndicator(string)) {
      return STYLE_DOUBLE;
    }
    if (!forceQuotes) {
      return hasFoldableLine ? STYLE_FOLDED : STYLE_LITERAL;
    }
    return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
  }
  function writeScalar(state, string, level, iskey, inblock) {
    state.dump = (function() {
      if (string.length === 0) {
        return state.quotingType === QUOTING_TYPE_DOUBLE ? '""' : "''";
      }
      if (!state.noCompatMode) {
        if (DEPRECATED_BOOLEANS_SYNTAX.indexOf(string) !== -1 || DEPRECATED_BASE60_SYNTAX.test(string)) {
          return state.quotingType === QUOTING_TYPE_DOUBLE ? '"' + string + '"' : "'" + string + "'";
        }
      }
      const indent = state.indent * Math.max(1, level);
      const lineWidth = state.lineWidth === -1 ? -1 : Math.max(Math.min(state.lineWidth, 40), state.lineWidth - indent);
      const singleLineOnly = iskey || // No block styles in flow mode.
      state.flowLevel > -1 && level >= state.flowLevel;
      function testAmbiguity(string2) {
        return testImplicitResolving(state, string2);
      }
      switch (chooseScalarStyle(
        string,
        singleLineOnly,
        state.indent,
        lineWidth,
        testAmbiguity,
        state.quotingType,
        state.forceQuotes && !iskey,
        inblock
      )) {
        case STYLE_PLAIN:
          return string;
        case STYLE_SINGLE:
          return "'" + string.replace(/'/g, "''") + "'";
        case STYLE_LITERAL:
          return "|" + blockHeader(string, state.indent) + dropEndingNewline(indentString(string, indent));
        case STYLE_FOLDED:
          return ">" + blockHeader(string, state.indent) + dropEndingNewline(indentString(foldString(string, lineWidth), indent));
        case STYLE_DOUBLE:
          return '"' + escapeString(string) + '"';
        default:
          throw new YAMLException2("impossible error: invalid scalar style");
      }
    })();
  }
  function blockHeader(string, indentPerLevel) {
    const indentIndicator = needIndentIndicator(string) ? String(indentPerLevel) : "";
    const clip = string[string.length - 1] === "\n";
    const keep = clip && (string[string.length - 2] === "\n" || string === "\n");
    const chomp = keep ? "+" : clip ? "" : "-";
    return indentIndicator + chomp + "\n";
  }
  function dropEndingNewline(string) {
    return string[string.length - 1] === "\n" ? string.slice(0, -1) : string;
  }
  function foldString(string, width) {
    const lineRe = /(\n+)([^\n]*)/g;
    let result = (function() {
      let nextLF = string.indexOf("\n");
      nextLF = nextLF !== -1 ? nextLF : string.length;
      lineRe.lastIndex = nextLF;
      return foldLine(string.slice(0, nextLF), width);
    })();
    let prevMoreIndented = string[0] === "\n" || string[0] === " ";
    let moreIndented;
    let match;
    while (match = lineRe.exec(string)) {
      const prefix = match[1];
      const line = match[2];
      moreIndented = line[0] === " ";
      result += prefix + (!prevMoreIndented && !moreIndented && line !== "" ? "\n" : "") + foldLine(line, width);
      prevMoreIndented = moreIndented;
    }
    return result;
  }
  function foldLine(line, width) {
    if (line === "" || line[0] === " ") return line;
    const breakRe = / [^ ]/g;
    let match;
    let start = 0;
    let end;
    let curr = 0;
    let next = 0;
    let result = "";
    while (match = breakRe.exec(line)) {
      next = match.index;
      if (next - start > width) {
        end = curr > start ? curr : next;
        result += "\n" + line.slice(start, end);
        start = end + 1;
      }
      curr = next;
    }
    result += "\n";
    if (line.length - start > width && curr > start) {
      result += line.slice(start, curr) + "\n" + line.slice(curr + 1);
    } else {
      result += line.slice(start);
    }
    return result.slice(1);
  }
  function escapeString(string) {
    let result = "";
    let char = 0;
    for (let i2 = 0; i2 < string.length; char >= 65536 ? i2 += 2 : i2++) {
      char = codePointAt(string, i2);
      const escapeSeq = ESCAPE_SEQUENCES[char];
      if (!escapeSeq && isPrintable(char)) {
        result += string[i2];
        if (char >= 65536) result += string[i2 + 1];
      } else {
        result += escapeSeq || encodeHex(char);
      }
    }
    return result;
  }
  function writeFlowSequence(state, level, object) {
    let _result = "";
    const _tag = state.tag;
    for (let index = 0, length = object.length; index < length; index += 1) {
      let value = object[index];
      if (state.replacer) {
        value = state.replacer.call(object, String(index), value);
      }
      if (writeNode(state, level, value, false, false) || typeof value === "undefined" && writeNode(state, level, null, false, false)) {
        if (_result !== "") _result += "," + (!state.condenseFlow ? " " : "");
        _result += state.dump;
      }
    }
    state.tag = _tag;
    state.dump = "[" + _result + "]";
  }
  function writeBlockSequence(state, level, object, compact) {
    let _result = "";
    const _tag = state.tag;
    for (let index = 0, length = object.length; index < length; index += 1) {
      let value = object[index];
      if (state.replacer) {
        value = state.replacer.call(object, String(index), value);
      }
      if (writeNode(state, level + 1, value, true, true, false, true) || typeof value === "undefined" && writeNode(state, level + 1, null, true, true, false, true)) {
        if (!compact || _result !== "") {
          _result += generateNextLine(state, level);
        }
        if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
          _result += "-";
        } else {
          _result += "- ";
        }
        _result += state.dump;
      }
    }
    state.tag = _tag;
    state.dump = _result || "[]";
  }
  function writeFlowMapping(state, level, object) {
    let _result = "";
    const _tag = state.tag;
    const objectKeyList = Object.keys(object);
    for (let index = 0, length = objectKeyList.length; index < length; index += 1) {
      let pairBuffer = "";
      if (_result !== "") pairBuffer += ", ";
      if (state.condenseFlow) pairBuffer += '"';
      const objectKey = objectKeyList[index];
      let objectValue = object[objectKey];
      if (state.replacer) {
        objectValue = state.replacer.call(object, objectKey, objectValue);
      }
      if (!writeNode(state, level, objectKey, false, false)) {
        continue;
      }
      if (state.dump.length > 1024) pairBuffer += "? ";
      pairBuffer += state.dump + (state.condenseFlow ? '"' : "") + ":" + (state.condenseFlow ? "" : " ");
      if (!writeNode(state, level, objectValue, false, false)) {
        continue;
      }
      pairBuffer += state.dump;
      _result += pairBuffer;
    }
    state.tag = _tag;
    state.dump = "{" + _result + "}";
  }
  function writeBlockMapping(state, level, object, compact) {
    let _result = "";
    const _tag = state.tag;
    const objectKeyList = Object.keys(object);
    if (state.sortKeys === true) {
      objectKeyList.sort();
    } else if (typeof state.sortKeys === "function") {
      objectKeyList.sort(state.sortKeys);
    } else if (state.sortKeys) {
      throw new YAMLException2("sortKeys must be a boolean or a function");
    }
    for (let index = 0, length = objectKeyList.length; index < length; index += 1) {
      let pairBuffer = "";
      if (!compact || _result !== "") {
        pairBuffer += generateNextLine(state, level);
      }
      const objectKey = objectKeyList[index];
      let objectValue = object[objectKey];
      if (state.replacer) {
        objectValue = state.replacer.call(object, objectKey, objectValue);
      }
      if (!writeNode(state, level + 1, objectKey, true, true, true)) {
        continue;
      }
      const explicitPair = state.tag !== null && state.tag !== "?" || state.dump && state.dump.length > 1024;
      if (explicitPair) {
        if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
          pairBuffer += "?";
        } else {
          pairBuffer += "? ";
        }
      }
      pairBuffer += state.dump;
      if (explicitPair) {
        pairBuffer += generateNextLine(state, level);
      }
      if (!writeNode(state, level + 1, objectValue, true, explicitPair)) {
        continue;
      }
      if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
        pairBuffer += ":";
      } else {
        pairBuffer += ": ";
      }
      pairBuffer += state.dump;
      _result += pairBuffer;
    }
    state.tag = _tag;
    state.dump = _result || "{}";
  }
  function detectType(state, object, explicit) {
    const typeList = explicit ? state.explicitTypes : state.implicitTypes;
    for (let index = 0, length = typeList.length; index < length; index += 1) {
      const type2 = typeList[index];
      if ((type2.instanceOf || type2.predicate) && (!type2.instanceOf || typeof object === "object" && object instanceof type2.instanceOf) && (!type2.predicate || type2.predicate(object))) {
        if (explicit) {
          if (type2.multi && type2.representName) {
            state.tag = type2.representName(object);
          } else {
            state.tag = type2.tag;
          }
        } else {
          state.tag = "?";
        }
        if (type2.represent) {
          const style = state.styleMap[type2.tag] || type2.defaultStyle;
          let _result;
          if (_toString.call(type2.represent) === "[object Function]") {
            _result = type2.represent(object, style);
          } else if (_hasOwnProperty.call(type2.represent, style)) {
            _result = type2.represent[style](object, style);
          } else {
            throw new YAMLException2("!<" + type2.tag + '> tag resolver accepts not "' + style + '" style');
          }
          state.dump = _result;
        }
        return true;
      }
    }
    return false;
  }
  function writeNode(state, level, object, block, compact, iskey, isblockseq) {
    state.tag = null;
    state.dump = object;
    if (!detectType(state, object, false)) {
      detectType(state, object, true);
    }
    const type2 = _toString.call(state.dump);
    const inblock = block;
    if (block) {
      block = state.flowLevel < 0 || state.flowLevel > level;
    }
    const objectOrArray = type2 === "[object Object]" || type2 === "[object Array]";
    let duplicateIndex;
    let duplicate;
    if (objectOrArray) {
      duplicateIndex = state.duplicates.indexOf(object);
      duplicate = duplicateIndex !== -1;
    }
    if (state.tag !== null && state.tag !== "?" || duplicate || state.indent !== 2 && level > 0) {
      compact = false;
    }
    if (duplicate && state.usedDuplicates[duplicateIndex]) {
      state.dump = "*ref_" + duplicateIndex;
    } else {
      if (objectOrArray && duplicate && !state.usedDuplicates[duplicateIndex]) {
        state.usedDuplicates[duplicateIndex] = true;
      }
      if (type2 === "[object Object]") {
        if (block && Object.keys(state.dump).length !== 0) {
          writeBlockMapping(state, level, state.dump, compact);
          if (duplicate) {
            state.dump = "&ref_" + duplicateIndex + state.dump;
          }
        } else {
          writeFlowMapping(state, level, state.dump);
          if (duplicate) {
            state.dump = "&ref_" + duplicateIndex + " " + state.dump;
          }
        }
      } else if (type2 === "[object Array]") {
        if (block && state.dump.length !== 0) {
          if (state.noArrayIndent && !isblockseq && level > 0) {
            writeBlockSequence(state, level - 1, state.dump, compact);
          } else {
            writeBlockSequence(state, level, state.dump, compact);
          }
          if (duplicate) {
            state.dump = "&ref_" + duplicateIndex + state.dump;
          }
        } else {
          writeFlowSequence(state, level, state.dump);
          if (duplicate) {
            state.dump = "&ref_" + duplicateIndex + " " + state.dump;
          }
        }
      } else if (type2 === "[object String]") {
        if (state.tag !== "?") {
          writeScalar(state, state.dump, level, iskey, inblock);
        }
      } else if (type2 === "[object Undefined]") {
        return false;
      } else {
        if (state.skipInvalid) return false;
        throw new YAMLException2("unacceptable kind of an object to dump " + type2);
      }
      if (state.tag !== null && state.tag !== "?") {
        let tagStr = encodeURI(
          state.tag[0] === "!" ? state.tag.slice(1) : state.tag
        ).replace(/!/g, "%21");
        if (state.tag[0] === "!") {
          tagStr = "!" + tagStr;
        } else if (tagStr.slice(0, 18) === "tag:yaml.org,2002:") {
          tagStr = "!!" + tagStr.slice(18);
        } else {
          tagStr = "!<" + tagStr + ">";
        }
        state.dump = tagStr + " " + state.dump;
      }
    }
    return true;
  }
  function getDuplicateReferences(object, state) {
    const objects = [];
    const duplicatesIndexes = [];
    inspectNode(object, objects, duplicatesIndexes);
    const length = duplicatesIndexes.length;
    for (let index = 0; index < length; index += 1) {
      state.duplicates.push(objects[duplicatesIndexes[index]]);
    }
    state.usedDuplicates = new Array(length);
  }
  function inspectNode(object, objects, duplicatesIndexes) {
    if (object !== null && typeof object === "object") {
      const index = objects.indexOf(object);
      if (index !== -1) {
        if (duplicatesIndexes.indexOf(index) === -1) {
          duplicatesIndexes.push(index);
        }
      } else {
        objects.push(object);
        if (Array.isArray(object)) {
          for (let i2 = 0, length = object.length; i2 < length; i2 += 1) {
            inspectNode(object[i2], objects, duplicatesIndexes);
          }
        } else {
          const objectKeyList = Object.keys(object);
          for (let i2 = 0, length = objectKeyList.length; i2 < length; i2 += 1) {
            inspectNode(object[objectKeyList[i2]], objects, duplicatesIndexes);
          }
        }
      }
    }
  }
  function dump2(input, options) {
    options = options || {};
    const state = new State(options);
    if (!state.noRefs) getDuplicateReferences(input, state);
    let value = input;
    if (state.replacer) {
      value = state.replacer.call({ "": value }, "", value);
    }
    if (writeNode(state, 0, value, true, true)) return state.dump + "\n";
    return "";
  }
  dumper.dump = dump2;
  return dumper;
}
var hasRequiredJsYaml;
function requireJsYaml() {
  if (hasRequiredJsYaml) return jsYaml;
  hasRequiredJsYaml = 1;
  const loader2 = requireLoader();
  const dumper2 = requireDumper();
  function renamed(from, to) {
    return function() {
      throw new Error("Function yaml." + from + " is removed in js-yaml 4. Use yaml." + to + " instead, which is now safe by default.");
    };
  }
  jsYaml.Type = requireType();
  jsYaml.Schema = requireSchema();
  jsYaml.FAILSAFE_SCHEMA = requireFailsafe();
  jsYaml.JSON_SCHEMA = requireJson();
  jsYaml.CORE_SCHEMA = requireCore();
  jsYaml.DEFAULT_SCHEMA = require_default();
  jsYaml.load = loader2.load;
  jsYaml.loadAll = loader2.loadAll;
  jsYaml.dump = dumper2.dump;
  jsYaml.YAMLException = requireException();
  jsYaml.types = {
    binary: requireBinary(),
    float: requireFloat(),
    map: requireMap(),
    null: require_null(),
    pairs: requirePairs(),
    set: requireSet(),
    timestamp: requireTimestamp(),
    bool: requireBool(),
    int: requireInt(),
    merge: requireMerge(),
    omap: requireOmap(),
    seq: requireSeq(),
    str: requireStr()
  };
  jsYaml.safeLoad = renamed("safeLoad", "load");
  jsYaml.safeLoadAll = renamed("safeLoadAll", "loadAll");
  jsYaml.safeDump = renamed("safeDump", "dump");
  return jsYaml;
}
var jsYamlExports = requireJsYaml();
var yaml = /* @__PURE__ */ getDefaultExportFromCjs(jsYamlExports);
var {
  Type,
  Schema,
  FAILSAFE_SCHEMA,
  JSON_SCHEMA,
  CORE_SCHEMA,
  DEFAULT_SCHEMA,
  load,
  loadAll,
  dump,
  YAMLException,
  types,
  safeLoad,
  safeLoadAll,
  safeDump
} = yaml;

// ../web/src/lib/composition/frontmatter.ts
var FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/;
function generate(title, {
  createdAt,
  updatedAt,
  description = "",
  tags = []
}) {
  return serialize({ title, description, tags: [...tags], createdAt, updatedAt });
}
function parse(content) {
  const match = FRONTMATTER_RE.exec(content);
  if (match === null) return [null, content];
  let data;
  try {
    data = yaml.load(match[1]);
  } catch {
    return [null, content];
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return [null, content];
  }
  const record = data;
  const fm = {
    title: asString(record.title),
    description: asString(record.description),
    tags: asTagList(record.tags),
    createdAt: asString(record.createdAt),
    updatedAt: asString(record.updatedAt)
  };
  return [fm, content.slice(match[0].length)];
}
function render(fm, body) {
  return serialize(fm) + body;
}
function strip(content) {
  const [, body] = parse(content);
  return body;
}
function tagsToString(tags) {
  return tags.map((t) => t.trim()).filter((t) => t !== "").join(",");
}
function tagsFromString(tags) {
  return tags.split(",").map((t) => t.trim()).filter((t) => t !== "");
}
function serialize(fm) {
  const data = {
    title: fm.title,
    description: fm.description,
    tags: [...fm.tags],
    createdAt: fm.createdAt,
    updatedAt: fm.updatedAt
  };
  const yamlText = yaml.dump(data, { sortKeys: false, noArrayIndent: true });
  return `---
${yamlText}---
`;
}
function asString(value) {
  if (value === null || value === void 0) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}
function asTagList(value) {
  if (Array.isArray(value)) {
    return value.map((v2) => String(v2).trim()).filter((v2) => v2 !== "");
  }
  if (typeof value === "string") return tagsFromString(value);
  return [];
}

// ../web/src/lib/composition/notesRepo.ts
function fromRow(row) {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    tags: row.tags,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    groupId: row.group_id
  };
}
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function listNotes() {
  const rows = getDb().prepare("SELECT * FROM notes ORDER BY updated_at DESC").all();
  return rows.map(fromRow);
}
function getNote(id) {
  const row = getDb().prepare("SELECT * FROM notes WHERE id = ?").get(id);
  return row ? fromRow(row) : null;
}
function createNote(title, tags = "", groupId = null) {
  const now = nowIso();
  const content = generate(title, {
    createdAt: now,
    updatedAt: now,
    tags: tagsFromString(tags)
  });
  const result = getDb().prepare(
    `INSERT INTO notes (title, content, tags, description, created_at, updated_at, group_id)
       VALUES (?, ?, ?, '', ?, ?, ?)`
  ).run(title, content, tags, now, now, groupId);
  const note = getNote(Number(result.lastInsertRowid));
  if (!note) throw new Error("Failed to read back the note that was just created");
  return note;
}
function updateNoteContent(id, content) {
  getDb().prepare("UPDATE notes SET content = ?, updated_at = ? WHERE id = ?").run(content, nowIso(), id);
}
function updateNote(id, content, fields) {
  getDb().prepare(
    `UPDATE notes SET content = ?, title = ?, tags = ?, description = ?, updated_at = ?
       WHERE id = ?`
  ).run(content, fields.title, fields.tags, fields.description, nowIso(), id);
}
function setNoteGroup(id, groupId) {
  getDb().prepare("UPDATE notes SET group_id = ? WHERE id = ?").run(groupId, id);
}

// ../web/src/lib/composition/groupMove.ts
function wouldCreateCycle(groups, id, newParentId) {
  const parentOf = new Map(groups.map((g2) => [g2.id, g2.parentId]));
  const seen = /* @__PURE__ */ new Set();
  let cursor = newParentId;
  while (cursor !== null && !seen.has(cursor)) {
    if (cursor === id) return true;
    seen.add(cursor);
    cursor = parentOf.get(cursor) ?? null;
  }
  return false;
}

// ../web/src/lib/composition/sunSchedule.ts
var RAMP_HALF_WIDTH_MS = 45 * 60 * 1e3;
var INK_FLIP_LEVEL = 0.45;
function smoothstep(progress) {
  return progress * progress * (3 - 2 * progress);
}
function sunLevel(events, now) {
  const sorted = [...events].sort((a2, b2) => a2.at - b2.at);
  let previous;
  for (const event of sorted) {
    const progress = (now - event.at + RAMP_HALF_WIDTH_MS) / (2 * RAMP_HALF_WIDTH_MS);
    if (progress >= 0 && progress <= 1) {
      const eased = smoothstep(progress);
      return event.kind === "sunrise" ? eased : 1 - eased;
    }
    if (progress < 0) break;
    previous = event;
  }
  if (previous) return previous.kind === "sunrise" ? 1 : 0;
  const next = sorted[0];
  if (!next) return 0;
  return next.kind === "sunrise" ? 0 : 1;
}
function toneForLevel(level) {
  return level >= INK_FLIP_LEVEL ? "light" : "dark";
}
function sunThemeAttributes(level) {
  return { tone: toneForLevel(level), autoLight: `${(level * 100).toFixed(1)}%` };
}
function fallbackSunEvents(now) {
  const events = [];
  for (const dayOffset of [-1, 0, 1]) {
    const day = new Date(now);
    day.setDate(day.getDate() + dayOffset);
    const at = (hour, minute) => new Date(day).setHours(hour, minute, 0, 0);
    events.push({ at: at(6, 30), kind: "sunrise" }, { at: at(18, 30), kind: "sunset" });
  }
  return events;
}

// ../web/src/lib/composition/trash.ts
var TRASH_RETENTION_DAYS = 60;
var DAY_MS = 24 * 60 * 60 * 1e3;
var EMPTY_TRASH = { notes: [], groups: [] };
function expiryOf(deletedAt) {
  return new Date(new Date(deletedAt).getTime() + TRASH_RETENTION_DAYS * DAY_MS).toISOString();
}
function retentionCutoff(now = /* @__PURE__ */ new Date()) {
  return new Date(now.getTime() - TRASH_RETENTION_DAYS * DAY_MS).toISOString();
}

// ../web/src/lib/composition/searchIndex.ts
import fs3 from "node:fs";
import path4 from "node:path";

// ../web/node_modules/.pnpm/meilisearch@0.62.0/node_modules/meilisearch/dist/index.js
var n = {
  INDEX_CREATION_FAILED: "index_creation_failed",
  MISSING_INDEX_UID: "missing_index_uid",
  INDEX_ALREADY_EXISTS: "index_already_exists",
  INDEX_NOT_FOUND: "index_not_found",
  INVALID_INDEX_UID: "invalid_index_uid",
  INDEX_NOT_ACCESSIBLE: "index_not_accessible",
  INVALID_INDEX_OFFSET: "invalid_index_offset",
  INVALID_INDEX_LIMIT: "invalid_index_limit",
  INVALID_STATE: "invalid_state",
  PRIMARY_KEY_INFERENCE_FAILED: "primary_key_inference_failed",
  INDEX_PRIMARY_KEY_ALREADY_EXISTS: "index_primary_key_already_exists",
  INVALID_INDEX_PRIMARY_KEY: "invalid_index_primary_key",
  DOCUMENTS_FIELDS_LIMIT_REACHED: "document_fields_limit_reached",
  MISSING_DOCUMENT_ID: "missing_document_id",
  INVALID_DOCUMENT_ID: "invalid_document_id",
  INVALID_CONTENT_TYPE: "invalid_content_type",
  MISSING_CONTENT_TYPE: "missing_content_type",
  INVALID_DOCUMENT_FIELDS: "invalid_document_fields",
  INVALID_DOCUMENT_LIMIT: "invalid_document_limit",
  INVALID_DOCUMENT_OFFSET: "invalid_document_offset",
  INVALID_DOCUMENT_FILTER: "invalid_document_filter",
  MISSING_DOCUMENT_FILTER: "missing_document_filter",
  INVALID_DOCUMENT_VECTORS_FIELD: "invalid_document_vectors_field",
  PAYLOAD_TOO_LARGE: "payload_too_large",
  MISSING_PAYLOAD: "missing_payload",
  MALFORMED_PAYLOAD: "malformed_payload",
  NO_SPACE_LEFT_ON_DEVICE: "no_space_left_on_device",
  INVALID_STORE_FILE: "invalid_store_file",
  INVALID_RANKING_RULES: "missing_document_id",
  INVALID_REQUEST: "invalid_request",
  INVALID_DOCUMENT_GEO_FIELD: "invalid_document_geo_field",
  INVALID_SEARCH_Q: "invalid_search_q",
  INVALID_SEARCH_OFFSET: "invalid_search_offset",
  INVALID_SEARCH_LIMIT: "invalid_search_limit",
  INVALID_SEARCH_PAGE: "invalid_search_page",
  INVALID_SEARCH_HITS_PER_PAGE: "invalid_search_hits_per_page",
  INVALID_SEARCH_ATTRIBUTES_TO_RETRIEVE: "invalid_search_attributes_to_retrieve",
  INVALID_SEARCH_ATTRIBUTES_TO_CROP: "invalid_search_attributes_to_crop",
  INVALID_SEARCH_CROP_LENGTH: "invalid_search_crop_length",
  INVALID_SEARCH_ATTRIBUTES_TO_HIGHLIGHT: "invalid_search_attributes_to_highlight",
  INVALID_SEARCH_SHOW_MATCHES_POSITION: "invalid_search_show_matches_position",
  INVALID_SEARCH_FILTER: "invalid_search_filter",
  INVALID_SEARCH_SORT: "invalid_search_sort",
  INVALID_SEARCH_FACETS: "invalid_search_facets",
  INVALID_SEARCH_HIGHLIGHT_PRE_TAG: "invalid_search_highlight_pre_tag",
  INVALID_SEARCH_HIGHLIGHT_POST_TAG: "invalid_search_highlight_post_tag",
  INVALID_SEARCH_CROP_MARKER: "invalid_search_crop_marker",
  INVALID_SEARCH_MATCHING_STRATEGY: "invalid_search_matching_strategy",
  INVALID_SEARCH_VECTOR: "invalid_search_vector",
  INVALID_SEARCH_ATTRIBUTES_TO_SEARCH_ON: "invalid_search_attributes_to_search_on",
  BAD_REQUEST: "bad_request",
  DOCUMENT_NOT_FOUND: "document_not_found",
  INTERNAL: "internal",
  INVALID_API_KEY: "invalid_api_key",
  INVALID_API_KEY_DESCRIPTION: "invalid_api_key_description",
  INVALID_API_KEY_ACTIONS: "invalid_api_key_actions",
  INVALID_API_KEY_INDEXES: "invalid_api_key_indexes",
  INVALID_API_KEY_EXPIRES_AT: "invalid_api_key_expires_at",
  API_KEY_NOT_FOUND: "api_key_not_found",
  IMMUTABLE_API_KEY_UID: "immutable_api_key_uid",
  IMMUTABLE_API_KEY_ACTIONS: "immutable_api_key_actions",
  IMMUTABLE_API_KEY_INDEXES: "immutable_api_key_indexes",
  IMMUTABLE_API_KEY_EXPIRES_AT: "immutable_api_key_expires_at",
  IMMUTABLE_API_KEY_CREATED_AT: "immutable_api_key_created_at",
  IMMUTABLE_API_KEY_UPDATED_AT: "immutable_api_key_updated_at",
  MISSING_AUTHORIZATION_HEADER: "missing_authorization_header",
  UNRETRIEVABLE_DOCUMENT: "unretrievable_document",
  MAX_DATABASE_SIZE_LIMIT_REACHED: "database_size_limit_reached",
  TASK_NOT_FOUND: "task_not_found",
  DUMP_PROCESS_FAILED: "dump_process_failed",
  DUMP_NOT_FOUND: "dump_not_found",
  INVALID_SWAP_DUPLICATE_INDEX_FOUND: "invalid_swap_duplicate_index_found",
  INVALID_SWAP_INDEXES: "invalid_swap_indexes",
  MISSING_SWAP_INDEXES: "missing_swap_indexes",
  MISSING_MASTER_KEY: "missing_master_key",
  INVALID_TASK_TYPES: "invalid_task_types",
  INVALID_TASK_UIDS: "invalid_task_uids",
  INVALID_TASK_STATUSES: "invalid_task_statuses",
  INVALID_TASK_LIMIT: "invalid_task_limit",
  INVALID_TASK_FROM: "invalid_task_from",
  INVALID_TASK_CANCELED_BY: "invalid_task_canceled_by",
  MISSING_TASK_FILTERS: "missing_task_filters",
  TOO_MANY_OPEN_FILES: "too_many_open_files",
  IO_ERROR: "io_error",
  INVALID_TASK_INDEX_UIDS: "invalid_task_index_uids",
  IMMUTABLE_INDEX_UID: "immutable_index_uid",
  IMMUTABLE_INDEX_CREATED_AT: "immutable_index_created_at",
  IMMUTABLE_INDEX_UPDATED_AT: "immutable_index_updated_at",
  INVALID_SETTINGS_DISPLAYED_ATTRIBUTES: "invalid_settings_displayed_attributes",
  INVALID_SETTINGS_SEARCHABLE_ATTRIBUTES: "invalid_settings_searchable_attributes",
  INVALID_SETTINGS_FILTERABLE_ATTRIBUTES: "invalid_settings_filterable_attributes",
  INVALID_SETTINGS_SORTABLE_ATTRIBUTES: "invalid_settings_sortable_attributes",
  INVALID_SETTINGS_RANKING_RULES: "invalid_settings_ranking_rules",
  INVALID_SETTINGS_STOP_WORDS: "invalid_settings_stop_words",
  INVALID_SETTINGS_SYNONYMS: "invalid_settings_synonyms",
  INVALID_SETTINGS_DISTINCT_ATTRIBUTE: "invalid_settings_distinct_attribute",
  INVALID_SETTINGS_TYPO_TOLERANCE: "invalid_settings_typo_tolerance",
  INVALID_SETTINGS_FACETING: "invalid_settings_faceting",
  INVALID_SETTINGS_PAGINATION: "invalid_settings_pagination",
  INVALID_SETTINGS_SEARCH_CUTOFF_MS: "invalid_settings_search_cutoff_ms",
  INVALID_SETTINGS_LOCALIZED_ATTRIBUTES: "invalid_settings_localized_attributes",
  INVALID_TASK_BEFORE_ENQUEUED_AT: "invalid_task_before_enqueued_at",
  INVALID_TASK_AFTER_ENQUEUED_AT: "invalid_task_after_enqueued_at",
  INVALID_TASK_BEFORE_STARTED_AT: "invalid_task_before_started_at",
  INVALID_TASK_AFTER_STARTED_AT: "invalid_task_after_started_at",
  INVALID_TASK_BEFORE_FINISHED_AT: "invalid_task_before_finished_at",
  INVALID_TASK_AFTER_FINISHED_AT: "invalid_task_after_finished_at",
  MISSING_API_KEY_ACTIONS: "missing_api_key_actions",
  MISSING_API_KEY_INDEXES: "missing_api_key_indexes",
  MISSING_API_KEY_EXPIRES_AT: "missing_api_key_expires_at",
  INVALID_API_KEY_LIMIT: "invalid_api_key_limit",
  INVALID_API_KEY_OFFSET: "invalid_api_key_offset",
  INVALID_FACET_SEARCH_FACET_NAME: "invalid_facet_search_facet_name",
  MISSING_FACET_SEARCH_FACET_NAME: "missing_facet_search_facet_name",
  INVALID_FACET_SEARCH_FACET_QUERY: "invalid_facet_search_facet_query",
  INVALID_SEARCH_RANKING_SCORE_THRESHOLD: "invalid_search_ranking_score_threshold",
  INVALID_SIMILAR_RANKING_SCORE_THRESHOLD: "invalid_similar_ranking_score_threshold"
};
var r = class extends Error {
  name = "MeilisearchError";
};
var i = class extends r {
  name = "MeilisearchApiError";
  cause;
  response;
  constructor(e, t) {
    super(t?.message ?? `${e.status}: ${e.statusText}`), this.response = e, t !== void 0 && (this.cause = t);
  }
};
var a = class extends r {
  name = "MeilisearchRequestError";
  constructor(e, t) {
    super(`Request to ${e} has failed`, { cause: t });
  }
};
var o = class extends r {
  name = "MeilisearchRequestTimeOutError";
  cause;
  constructor(e, t) {
    super(`request timed out after ${e}ms`);
    let n2 = new Headers(t.headers);
    n2.has("Authorization") && n2.set("Authorization", "<redacted>"), this.cause = {
      timeout: e,
      requestInit: {
        ...t,
        headers: n2
      }
    };
  }
};
var s = class extends r {
  name = "MeilisearchTaskTimeOutError";
  cause;
  constructor(e, t) {
    super(`timeout of ${t}ms has exceeded on task ${e} when waiting for it to be resolved.`), this.cause = {
      taskUid: e,
      timeout: t
    };
  }
};
var c = {
  name: "meilisearch",
  version: "0.62.0",
  description: "The Meilisearch JS client for Node.js and the browser.",
  keywords: [
    "meilisearch",
    "search",
    "instant",
    "relevant",
    "client",
    "wrapper",
    "meili"
  ],
  author: "cvermand <charlotte@meilisearch.com>",
  contributors: ["qdequele <quentin@meilisearch.com>"],
  license: "MIT",
  type: "module",
  exports: {
    ".": "./src/index.ts",
    "./*": "./src/*.ts"
  },
  publishConfig: { exports: {
    ".": "./dist/index.js",
    "./token": "./dist/token.js",
    "./package.json": "./package.json"
  } },
  sideEffects: false,
  files: [
    "src",
    "dist",
    "CONTRIBUTING.md"
  ],
  engines: { node: "^20.19.0 || >=22.12.0" },
  repository: {
    type: "git",
    url: "https://github.com/meilisearch/meilisearch-js.git"
  },
  scripts: {
    "playground:javascript": "vite serve playgrounds/javascript --open",
    "docs:api": "typedoc",
    "docs:dev": "pnpm docs:api && vitepress dev docs",
    "docs:build": "pnpm docs:api && vitepress build docs",
    "build:docs": "pnpm docs:build",
    build: "vite build && tsc -p tsconfig.build.json",
    test: "vitest run",
    "test:watch": "vitest watch",
    types: "tsc -p tsconfig.json --noEmit",
    "types:watch": "pnpm types --watch",
    fmt: "prettier -c .",
    "fmt:fix": "prettier -w .",
    lint: "oxlint --type-aware",
    "lint:fix": "oxlint --type-aware --fix",
    style: "pnpm fmt && pnpm lint",
    "style:fix": "pnpm fmt:fix && pnpm lint:fix",
    prepare: "husky"
  },
  devDependencies: {
    "@types/node": "24.12.0",
    "@vitest/coverage-v8": "4.1.9",
    "eslint-plugin-tsdoc": "0.5.2",
    globals: "^17.7.0",
    husky: "^9.1.7",
    "lint-staged": "16.4.0",
    oxlint: "1.50.0",
    "oxlint-tsgolint": "0.14.2",
    prettier: "^3.9.4",
    "prettier-plugin-jsdoc": "^1.8.1",
    typedoc: "^0.28.20",
    "typedoc-plugin-markdown": "^4.12.0",
    "typedoc-vitepress-theme": "^1.1.3",
    typescript: "5.9.3",
    vite: "8.1.3",
    vitepress: "^1.6.4",
    vitest: "4.1.9"
  },
  packageManager: "pnpm@10.32.1"
};
function l(e) {
  return e.startsWith("https://") || e.startsWith("http://") ? e : `http://${e}`;
}
function u(e) {
  return e.endsWith("/") || (e += "/"), e;
}
async function d(e) {
  let t = e.getReader(), n2 = new TextDecoder(), r2 = "";
  for (; ; ) {
    let { done: e2, value: i2 } = await t.read();
    if (e2) break;
    r2 += n2.decode(i2, { stream: true });
  }
  return r2 += n2.decode(), r2;
}
function f(e) {
  let t = e.trim();
  if (!t) return [];
  try {
    let e2 = JSON.parse(t);
    return Array.isArray(e2) ? e2 : [e2];
  } catch {
    return t.split(/\r?\n/).flatMap((e2) => e2.split(/(?<=})\s*(?=\{)/)).map((e2) => e2.trim()).filter((e2) => e2.length > 0).map((e2) => JSON.parse(e2));
  }
}
function p(e, t) {
  for (let [n2, r2] of Object.entries(t)) r2 != null && e.set(n2, Array.isArray(r2) ? r2.join() : r2 instanceof Date ? r2.toISOString() : String(r2));
}
function m(e, t) {
  let n2 = "X-Meilisearch-Client", r2 = `Meilisearch JavaScript (v${c.version})`, i2 = "Content-Type", a2 = "Authorization", o2 = new Headers(t);
  if (e.apiKey && !o2.has(a2) && o2.set(a2, `Bearer ${e.apiKey}`), o2.has(i2) || o2.set(i2, "application/json"), e.clientAgents !== void 0) {
    let t2 = e.clientAgents.concat(r2);
    o2.set(n2, t2.join(" ; "));
  } else o2.set(n2, r2);
  return o2;
}
var h = /* @__PURE__ */ Symbol("<timeout>");
function g(e, t) {
  let { signal: n2 } = e, r2 = new AbortController();
  if (n2 != null) {
    let e2 = null;
    if (n2.aborted) r2.abort(n2.reason);
    else {
      let t2 = () => r2.abort(n2.reason);
      n2.addEventListener("abort", t2, { once: true }), e2 = () => n2.removeEventListener("abort", t2), r2.signal.addEventListener("abort", e2, { once: true });
    }
    return () => {
      if (n2.aborted) return;
      let i2 = setTimeout(() => r2.abort(h), t), a2 = () => {
        clearTimeout(i2), e2 !== null && r2.signal.removeEventListener("abort", e2);
      };
      return n2.addEventListener("abort", a2, { once: true }), () => {
        n2.removeEventListener("abort", a2), a2();
      };
    };
  }
  return e.signal = r2.signal, () => {
    let e2 = setTimeout(() => r2.abort(h), t);
    return () => clearTimeout(e2);
  };
}
var _ = class {
  #e;
  #t;
  #n;
  #r;
  constructor(e) {
    let t = u(l(e.host));
    try {
      this.#e = new URL(t);
    } catch (e2) {
      throw new r("The provided host is not valid", { cause: e2 });
    }
    this.#t = {
      ...e.requestInit,
      headers: m(e, e.requestInit?.headers)
    }, this.#n = e.httpClient, this.#r = e.timeout;
  }
  #i(e, t) {
    if (e === void 0 && t === void 0) return this.#t.headers;
    let n2 = new Headers(e);
    t !== void 0 && !n2.has("Content-Type") && n2.set("Content-Type", t);
    for (let [e2, t2] of this.#t.headers) n2.has(e2) || n2.set(e2, t2);
    return n2;
  }
  #a({ path: e, method: t, params: n2, contentType: r2, body: i2, extraRequestInit: a2 }) {
    let o2 = new URL(e, this.#e);
    return n2 !== void 0 && p(o2.searchParams, n2), {
      url: o2,
      init: {
        method: t,
        body: r2 === void 0 || typeof i2 != "string" ? JSON.stringify(i2) : i2,
        ...a2,
        ...this.#t,
        headers: this.#i(a2?.headers, r2)
      }
    };
  }
  async #o(e) {
    let { url: t, init: n2 } = this.#a(e), r2 = (this.#r === void 0 ? null : g(n2, this.#r))?.(), s2, c2;
    try {
      if (this.#n !== void 0) return await this.#n(t, n2);
      s2 = await fetch(t, n2), c2 = await s2.text();
    } catch (e2) {
      throw new a(t.toString(), Object.is(e2, h) ? new o(this.#r, n2) : e2);
    } finally {
      r2?.();
    }
    let l2 = c2 === "" ? void 0 : JSON.parse(c2);
    if (!s2.ok) throw new i(s2, l2);
    return l2;
  }
  get(e) {
    return this.#o(e);
  }
  getStream(e) {
    return this.#s(e);
  }
  post(e) {
    return this.#o({
      ...e,
      method: "POST"
    });
  }
  put(e) {
    return this.#o({
      ...e,
      method: "PUT"
    });
  }
  patch(e) {
    return this.#o({
      ...e,
      method: "PATCH"
    });
  }
  delete(e) {
    return this.#o({
      ...e,
      method: "DELETE"
    });
  }
  postStream(e) {
    return this.#s({
      ...e,
      method: "POST"
    });
  }
  async #s(e) {
    let { url: t, init: n2 } = this.#a(e), s2 = (this.#r === void 0 ? null : g(n2, this.#r))?.(), c2;
    try {
      if (this.#n !== void 0) {
        let e2 = await this.#n(t, n2);
        if (!(e2 instanceof ReadableStream)) throw new r("Custom HTTP client must return a ReadableStream for streaming requests");
        return e2;
      }
      c2 = await fetch(t, n2);
    } catch (e2) {
      throw new a(t.toString(), Object.is(e2, h) ? new o(this.#r, n2) : e2);
    } finally {
      s2?.();
    }
    if (!c2.ok) {
      let e2 = await c2.text(), t2 = e2 === "" ? void 0 : JSON.parse(e2);
      throw new i(c2, t2);
    }
    if (!c2.body) throw new r("Response body is null - server did not return a readable stream");
    return c2.body;
  }
};
var v = /* @__PURE__ */ Symbol("<task timeout>");
function y(e) {
  return function(t) {
    return Object.defineProperty(t, "waitTask", { async value(n2) {
      return await e.waitForTask(await t, n2);
    } });
  };
}
var b = (e) => typeof e == "number" ? e : e.taskUid;
var x = class {
  #e;
  #t;
  #n;
  #r;
  constructor(e, t) {
    this.#e = e, this.#t = t?.timeout ?? 5e3, this.#n = t?.interval ?? 50, this.#r = y(this);
  }
  async getTask(e, t) {
    return await this.#e.get({
      path: `tasks/${e}`,
      extraRequestInit: t
    });
  }
  async getTasks(e) {
    return await this.#e.get({
      path: "tasks",
      params: e
    });
  }
  async getTaskDocuments(e, t) {
    return f(await d(await this.#e.getStream({
      path: `tasks/${e}/documents`,
      extraRequestInit: t
    })));
  }
  async waitForTask(e, t) {
    let n2 = b(e), r2 = t?.timeout ?? this.#t, i2 = t?.interval ?? this.#n, a2 = r2 > 0 ? new AbortController() : null, o2 = a2 === null ? void 0 : setTimeout(() => {
      a2.abort(v);
    }, r2);
    try {
      for (; ; ) {
        let e2 = await this.getTask(n2, { signal: a2?.signal });
        if (e2.status !== "enqueued" && e2.status !== "processing") return clearTimeout(o2), e2;
        i2 > 0 && await new Promise((e3) => setTimeout(e3, i2));
      }
    } catch (e2) {
      throw Object.is(e2.cause, v) ? new s(n2, r2) : e2;
    }
  }
  async *waitForTasksIter(e, t) {
    for await (let n2 of e) yield await this.waitForTask(n2, t);
  }
  async waitForTasks(...e) {
    let t = [];
    for await (let n2 of this.waitForTasksIter(...e)) t.push(n2);
    return t;
  }
  cancelTasks(e) {
    return this.#r(this.#e.post({
      path: "tasks/cancel",
      params: e
    }));
  }
  deleteTasks(e) {
    return this.#r(this.#e.delete({
      path: "tasks",
      params: e
    }));
  }
};
function S(e, t) {
  let n2 = y(t);
  return {
    post: (...t2) => n2(e.post(...t2)),
    put: (...t2) => n2(e.put(...t2)),
    patch: (...t2) => n2(e.patch(...t2)),
    delete: (...t2) => n2(e.delete(...t2))
  };
}
var C = class {
  uid;
  primaryKey;
  createdAt;
  updatedAt;
  httpRequest;
  tasks;
  #e;
  constructor(e, t, n2) {
    this.uid = t, this.primaryKey = n2, this.httpRequest = new _(e), this.tasks = new x(this.httpRequest, e.defaultWaitOptions), this.#e = S(this.httpRequest, this.tasks);
  }
  async search(e, t, n2) {
    return await this.httpRequest.post({
      path: `indexes/${this.uid}/search`,
      body: {
        q: e,
        ...t
      },
      extraRequestInit: n2
    });
  }
  async searchGet(e, t, n2) {
    let i2 = (e2) => {
      if (typeof e2 == "string") return e2;
      if (Array.isArray(e2)) throw new r("The filter query parameter should be in string format when using searchGet");
    }, a2 = {
      q: e,
      ...t,
      filter: i2(t?.filter),
      sort: t?.sort?.join(","),
      facets: t?.facets?.join(","),
      attributesToRetrieve: t?.attributesToRetrieve?.join(","),
      attributesToCrop: t?.attributesToCrop?.join(","),
      attributesToHighlight: t?.attributesToHighlight?.join(","),
      vector: t?.vector?.join(","),
      attributesToSearchOn: t?.attributesToSearchOn?.join(",")
    };
    return await this.httpRequest.get({
      path: `indexes/${this.uid}/search`,
      params: a2,
      extraRequestInit: n2
    });
  }
  async searchForFacetValues(e, t) {
    return await this.httpRequest.post({
      path: `indexes/${this.uid}/facet-search`,
      body: e,
      extraRequestInit: t
    });
  }
  async searchSimilarDocuments(e) {
    return await this.httpRequest.post({
      path: `indexes/${this.uid}/similar`,
      body: e
    });
  }
  async getRawInfo() {
    let e = await this.httpRequest.get({ path: `indexes/${this.uid}` });
    return this.primaryKey = e.primaryKey, this.updatedAt = new Date(e.updatedAt), this.createdAt = new Date(e.createdAt), e;
  }
  async fetchInfo() {
    return await this.getRawInfo(), this;
  }
  async fetchPrimaryKey() {
    return this.primaryKey = (await this.getRawInfo()).primaryKey, this.primaryKey;
  }
  static create(e, t = {}, n2) {
    let r2 = new _(n2);
    return S(r2, new x(r2)).post({
      path: "indexes",
      body: {
        ...t,
        uid: e
      }
    });
  }
  update(e) {
    return this.#e.patch({
      path: `indexes/${this.uid}`,
      body: e
    });
  }
  delete() {
    return this.#e.delete({ path: `indexes/${this.uid}` });
  }
  async getStats() {
    return await this.httpRequest.get({ path: `indexes/${this.uid}/stats` });
  }
  async getDocuments(e) {
    let t = `indexes/${this.uid}/documents`, n2 = e ? { ...e } : void 0;
    return n2 && Array.isArray(n2.sort) && n2.sort.length === 0 && delete n2.sort, n2?.filter === void 0 ? await this.httpRequest.get({
      path: t,
      params: n2
    }) : await this.httpRequest.post({
      path: `${t}/fetch`,
      body: n2
    });
  }
  async getDocument(e, t) {
    let n2 = Array.isArray(t?.fields) ? t.fields.join() : void 0;
    return await this.httpRequest.get({
      path: `indexes/${this.uid}/documents/${e}`,
      params: {
        ...t,
        fields: n2
      }
    });
  }
  addDocuments(e, t) {
    return this.#e.post({
      path: `indexes/${this.uid}/documents`,
      params: t,
      body: e
    });
  }
  addDocumentsFromString(e, t, n2) {
    return this.#e.post({
      path: `indexes/${this.uid}/documents`,
      body: e,
      params: n2,
      contentType: t
    });
  }
  addDocumentsInBatches(e, t = 1e3, n2) {
    let r2 = [];
    for (let i2 = 0; i2 < e.length; i2 += t) r2.push(this.addDocuments(e.slice(i2, i2 + t), n2));
    return r2;
  }
  updateDocuments(e, t) {
    return this.#e.put({
      path: `indexes/${this.uid}/documents`,
      params: t,
      body: e
    });
  }
  updateDocumentsInBatches(e, t = 1e3, n2) {
    let r2 = [];
    for (let i2 = 0; i2 < e.length; i2 += t) r2.push(this.updateDocuments(e.slice(i2, i2 + t), n2));
    return r2;
  }
  updateDocumentsFromString(e, t, n2) {
    return this.#e.put({
      path: `indexes/${this.uid}/documents`,
      body: e,
      params: n2,
      contentType: t
    });
  }
  deleteDocument(e, t) {
    return this.#e.delete({
      path: `indexes/${this.uid}/documents/${e}`,
      params: t
    });
  }
  deleteDocuments(e, t) {
    let n2 = !Array.isArray(e) && typeof e == "object" ? "documents/delete" : "documents/delete-batch";
    return this.#e.post({
      path: `indexes/${this.uid}/${n2}`,
      body: e,
      params: t
    });
  }
  deleteAllDocuments(e) {
    return this.#e.delete({
      path: `indexes/${this.uid}/documents`,
      params: e
    });
  }
  compact() {
    return this.#e.post({ path: `indexes/${this.uid}/compact` });
  }
  updateDocumentsByFunction(e, t) {
    return this.#e.post({
      path: `indexes/${this.uid}/documents/edit`,
      body: e,
      params: t
    });
  }
  async getSettings() {
    return await this.httpRequest.get({ path: `indexes/${this.uid}/settings` });
  }
  updateSettings(e) {
    return this.#e.patch({
      path: `indexes/${this.uid}/settings`,
      body: e
    });
  }
  resetSettings() {
    return this.#e.delete({ path: `indexes/${this.uid}/settings` });
  }
  async getPagination() {
    return await this.httpRequest.get({ path: `indexes/${this.uid}/settings/pagination` });
  }
  updatePagination(e) {
    return this.#e.patch({
      path: `indexes/${this.uid}/settings/pagination`,
      body: e
    });
  }
  resetPagination() {
    return this.#e.delete({ path: `indexes/${this.uid}/settings/pagination` });
  }
  async getSynonyms() {
    return await this.httpRequest.get({ path: `indexes/${this.uid}/settings/synonyms` });
  }
  updateSynonyms(e) {
    return this.#e.put({
      path: `indexes/${this.uid}/settings/synonyms`,
      body: e
    });
  }
  resetSynonyms() {
    return this.#e.delete({ path: `indexes/${this.uid}/settings/synonyms` });
  }
  async getStopWords() {
    return await this.httpRequest.get({ path: `indexes/${this.uid}/settings/stop-words` });
  }
  updateStopWords(e) {
    return this.#e.put({
      path: `indexes/${this.uid}/settings/stop-words`,
      body: e
    });
  }
  resetStopWords() {
    return this.#e.delete({ path: `indexes/${this.uid}/settings/stop-words` });
  }
  async getRankingRules() {
    return await this.httpRequest.get({ path: `indexes/${this.uid}/settings/ranking-rules` });
  }
  updateRankingRules(e) {
    return this.#e.put({
      path: `indexes/${this.uid}/settings/ranking-rules`,
      body: e
    });
  }
  resetRankingRules() {
    return this.#e.delete({ path: `indexes/${this.uid}/settings/ranking-rules` });
  }
  async getDistinctAttribute() {
    return await this.httpRequest.get({ path: `indexes/${this.uid}/settings/distinct-attribute` });
  }
  updateDistinctAttribute(e) {
    return this.#e.put({
      path: `indexes/${this.uid}/settings/distinct-attribute`,
      body: e
    });
  }
  resetDistinctAttribute() {
    return this.#e.delete({ path: `indexes/${this.uid}/settings/distinct-attribute` });
  }
  async getFilterableAttributes() {
    return await this.httpRequest.get({ path: `indexes/${this.uid}/settings/filterable-attributes` });
  }
  updateFilterableAttributes(e) {
    return this.#e.put({
      path: `indexes/${this.uid}/settings/filterable-attributes`,
      body: e
    });
  }
  resetFilterableAttributes() {
    return this.#e.delete({ path: `indexes/${this.uid}/settings/filterable-attributes` });
  }
  async getSortableAttributes() {
    return await this.httpRequest.get({ path: `indexes/${this.uid}/settings/sortable-attributes` });
  }
  updateSortableAttributes(e) {
    return this.#e.put({
      path: `indexes/${this.uid}/settings/sortable-attributes`,
      body: e
    });
  }
  resetSortableAttributes() {
    return this.#e.delete({ path: `indexes/${this.uid}/settings/sortable-attributes` });
  }
  async getSearchableAttributes() {
    return await this.httpRequest.get({ path: `indexes/${this.uid}/settings/searchable-attributes` });
  }
  updateSearchableAttributes(e) {
    return this.#e.put({
      path: `indexes/${this.uid}/settings/searchable-attributes`,
      body: e
    });
  }
  resetSearchableAttributes() {
    return this.#e.delete({ path: `indexes/${this.uid}/settings/searchable-attributes` });
  }
  async getDisplayedAttributes() {
    return await this.httpRequest.get({ path: `indexes/${this.uid}/settings/displayed-attributes` });
  }
  updateDisplayedAttributes(e) {
    return this.#e.put({
      path: `indexes/${this.uid}/settings/displayed-attributes`,
      body: e
    });
  }
  resetDisplayedAttributes() {
    return this.#e.delete({ path: `indexes/${this.uid}/settings/displayed-attributes` });
  }
  async getTypoTolerance() {
    return await this.httpRequest.get({ path: `indexes/${this.uid}/settings/typo-tolerance` });
  }
  updateTypoTolerance(e) {
    return this.#e.patch({
      path: `indexes/${this.uid}/settings/typo-tolerance`,
      body: e
    });
  }
  resetTypoTolerance() {
    return this.#e.delete({ path: `indexes/${this.uid}/settings/typo-tolerance` });
  }
  async getFaceting() {
    return await this.httpRequest.get({ path: `indexes/${this.uid}/settings/faceting` });
  }
  updateFaceting(e) {
    return this.#e.patch({
      path: `indexes/${this.uid}/settings/faceting`,
      body: e
    });
  }
  resetFaceting() {
    return this.#e.delete({ path: `indexes/${this.uid}/settings/faceting` });
  }
  async getSeparatorTokens() {
    return await this.httpRequest.get({ path: `indexes/${this.uid}/settings/separator-tokens` });
  }
  updateSeparatorTokens(e) {
    return this.#e.put({
      path: `indexes/${this.uid}/settings/separator-tokens`,
      body: e
    });
  }
  resetSeparatorTokens() {
    return this.#e.delete({ path: `indexes/${this.uid}/settings/separator-tokens` });
  }
  async getNonSeparatorTokens() {
    return await this.httpRequest.get({ path: `indexes/${this.uid}/settings/non-separator-tokens` });
  }
  updateNonSeparatorTokens(e) {
    return this.#e.put({
      path: `indexes/${this.uid}/settings/non-separator-tokens`,
      body: e
    });
  }
  resetNonSeparatorTokens() {
    return this.#e.delete({ path: `indexes/${this.uid}/settings/non-separator-tokens` });
  }
  async getDictionary() {
    return await this.httpRequest.get({ path: `indexes/${this.uid}/settings/dictionary` });
  }
  updateDictionary(e) {
    return this.#e.put({
      path: `indexes/${this.uid}/settings/dictionary`,
      body: e
    });
  }
  resetDictionary() {
    return this.#e.delete({ path: `indexes/${this.uid}/settings/dictionary` });
  }
  async getProximityPrecision() {
    return await this.httpRequest.get({ path: `indexes/${this.uid}/settings/proximity-precision` });
  }
  updateProximityPrecision(e) {
    return this.#e.put({
      path: `indexes/${this.uid}/settings/proximity-precision`,
      body: e
    });
  }
  resetProximityPrecision() {
    return this.#e.delete({ path: `indexes/${this.uid}/settings/proximity-precision` });
  }
  async getEmbedders() {
    return await this.httpRequest.get({ path: `indexes/${this.uid}/settings/embedders` });
  }
  updateEmbedders(e) {
    return this.#e.patch({
      path: `indexes/${this.uid}/settings/embedders`,
      body: e
    });
  }
  resetEmbedders() {
    return this.#e.delete({ path: `indexes/${this.uid}/settings/embedders` });
  }
  async getSearchCutoffMs() {
    return await this.httpRequest.get({ path: `indexes/${this.uid}/settings/search-cutoff-ms` });
  }
  updateSearchCutoffMs(e) {
    return this.#e.put({
      path: `indexes/${this.uid}/settings/search-cutoff-ms`,
      body: e
    });
  }
  resetSearchCutoffMs() {
    return this.#e.delete({ path: `indexes/${this.uid}/settings/search-cutoff-ms` });
  }
  async getLocalizedAttributes() {
    return await this.httpRequest.get({ path: `indexes/${this.uid}/settings/localized-attributes` });
  }
  updateLocalizedAttributes(e) {
    return this.#e.put({
      path: `indexes/${this.uid}/settings/localized-attributes`,
      body: e
    });
  }
  resetLocalizedAttributes() {
    return this.#e.delete({ path: `indexes/${this.uid}/settings/localized-attributes` });
  }
  async getForeignKeys() {
    return await this.httpRequest.get({ path: `indexes/${this.uid}/settings/foreign-keys` });
  }
  updateForeignKeys(e) {
    return this.#e.put({
      path: `indexes/${this.uid}/settings/foreign-keys`,
      body: e
    });
  }
  resetForeignKeys() {
    return this.#e.delete({ path: `indexes/${this.uid}/settings/foreign-keys` });
  }
  async getFacetSearch() {
    return await this.httpRequest.get({ path: `indexes/${this.uid}/settings/facet-search` });
  }
  updateFacetSearch(e) {
    return this.#e.put({
      path: `indexes/${this.uid}/settings/facet-search`,
      body: e
    });
  }
  resetFacetSearch() {
    return this.#e.delete({ path: `indexes/${this.uid}/settings/facet-search` });
  }
  async getPrefixSearch() {
    return await this.httpRequest.get({ path: `indexes/${this.uid}/settings/prefix-search` });
  }
  updatePrefixSearch(e) {
    return this.#e.put({
      path: `indexes/${this.uid}/settings/prefix-search`,
      body: e
    });
  }
  resetPrefixSearch() {
    return this.#e.delete({ path: `indexes/${this.uid}/settings/prefix-search` });
  }
  async getChat() {
    return await this.httpRequest.get({ path: `indexes/${this.uid}/settings/chat` });
  }
  updateChat(e) {
    return this.#e.patch({
      path: `indexes/${this.uid}/settings/chat`,
      body: e
    });
  }
  async getFields(e, t) {
    return await this.httpRequest.post({
      path: `indexes/${this.uid}/fields`,
      body: e || {},
      extraRequestInit: t
    });
  }
};
var w = class {
  #e;
  constructor(e) {
    this.#e = e;
  }
  async getBatch(e) {
    return await this.#e.get({ path: `batches/${e}` });
  }
  async getBatches(e) {
    return await this.#e.get({
      path: "batches",
      params: e
    });
  }
};
var T = class {
  #e;
  #t;
  constructor(e, t) {
    this.#e = e, this.#t = t;
  }
  async get() {
    return await this.#e.get({ path: `chats/${this.#t}/settings` });
  }
  async update(e) {
    return await this.#e.patch({
      path: `chats/${this.#t}/settings`,
      body: e
    });
  }
  async reset() {
    await this.#e.delete({ path: `chats/${this.#t}/settings` });
  }
  async streamCompletion(e) {
    if (!e.stream) throw Error("The SDK only supports streaming");
    return await this.#e.postStream({
      path: `chats/${this.#t}/chat/completions`,
      body: e
    });
  }
};
var E = class {
  config;
  httpRequest;
  #e;
  get tasks() {
    return this.#e;
  }
  #t;
  get batches() {
    return this.#t;
  }
  #n;
  constructor(e) {
    this.config = e, this.httpRequest = new _(e), this.#e = new x(this.httpRequest, e.defaultWaitOptions), this.#t = new w(this.httpRequest), this.#n = S(this.httpRequest, this.tasks);
  }
  index(e) {
    return new C(this.config, e);
  }
  async getIndex(e) {
    return new C(this.config, e).fetchInfo();
  }
  async getRawIndex(e) {
    return new C(this.config, e).getRawInfo();
  }
  async getIndexes(e) {
    let t = await this.getRawIndexes(e), n2 = t.results.map((e2) => new C(this.config, e2.uid, e2.primaryKey));
    return {
      ...t,
      results: n2
    };
  }
  async getRawIndexes(e) {
    return await this.httpRequest.get({
      path: "indexes",
      params: e
    });
  }
  createIndex(e, t) {
    return C.create(e, t, this.config);
  }
  updateIndex(e, t) {
    return new C(this.config, e).update(t);
  }
  deleteIndex(e) {
    return new C(this.config, e).delete();
  }
  async deleteIndexIfExists(e) {
    try {
      return await this.deleteIndex(e), true;
    } catch (e2) {
      if (e2?.cause?.code === n.INDEX_NOT_FOUND) return false;
      throw e2;
    }
  }
  swapIndexes(e) {
    return this.#n.post({
      path: "swap-indexes",
      body: e
    });
  }
  async multiSearch(e, t) {
    return await this.httpRequest.post({
      path: "multi-search",
      body: e,
      extraRequestInit: t
    });
  }
  chat(e) {
    return new T(this.httpRequest, e);
  }
  async getChatWorkspaces(e) {
    return await this.httpRequest.get({
      path: "chats",
      params: e
    });
  }
  async getChatWorkspace(e) {
    return await this.httpRequest.get({ path: `chats/${e}` });
  }
  async deleteChatWorkspace(e) {
    await this.httpRequest.delete({ path: `chats/${e}` });
  }
  async getDynamicSearchRules(e) {
    return await this.httpRequest.post({
      path: "dynamic-search-rules",
      body: e ?? {}
    });
  }
  async getDynamicSearchRule(e) {
    return await this.httpRequest.get({ path: `dynamic-search-rules/${e}` });
  }
  updateDynamicSearchRule(e, t) {
    return this.#n.patch({
      path: `dynamic-search-rules/${e}`,
      body: t
    });
  }
  deleteDynamicSearchRule(e) {
    return this.#n.delete({ path: `dynamic-search-rules/${e}` });
  }
  deleteAllDynamicSearchRules() {
    return this.#n.delete({ path: "dynamic-search-rules" });
  }
  async getWebhooks() {
    return await this.httpRequest.get({ path: "webhooks" });
  }
  async getWebhook(e) {
    return await this.httpRequest.get({ path: `webhooks/${e}` });
  }
  async createWebhook(e) {
    return await this.httpRequest.post({
      path: "webhooks",
      body: e
    });
  }
  async updateWebhook(e, t) {
    return await this.httpRequest.patch({
      path: `webhooks/${e}`,
      body: t
    });
  }
  async deleteWebhook(e) {
    await this.httpRequest.delete({ path: `webhooks/${e}` });
  }
  #r(e) {
    return this.#n.patch({
      path: "network",
      body: e
    });
  }
  #i(e, t) {
    let n2 = Object.entries(t);
    if (n2.length === 0) throw TypeError("initializeNetwork requires at least one shard when leader is set.");
    let r2 = {};
    for (let [t2, i2] of n2) {
      if (!Array.isArray(i2.remotes) || i2.remotes.length === 0) throw TypeError(`Shard "${t2}" must have at least one remote.`);
      let n3 = i2.remotes.filter((t3) => e[t3] === void 0);
      if (n3.length > 0) throw TypeError(`Shard "${t2}" references unknown remotes: ${n3.join(", ")}`);
      r2[t2] = { remotes: [...i2.remotes] };
    }
    return r2;
  }
  async getNetwork() {
    return await this.httpRequest.get({ path: "network" });
  }
  async updateNetwork(e) {
    return await this.httpRequest.patch({
      path: "network",
      body: e
    });
  }
  initializeNetwork(e) {
    let t = this.#i(e.remotes, e.shards);
    return this.#r({
      self: e.self,
      leader: e.self,
      remotes: e.remotes,
      shards: t
    });
  }
  addRemote(e) {
    return this.#r({ remotes: { [e.name]: e.remote } });
  }
  removeRemote(e) {
    return this.#r({ remotes: { [e.name]: null } });
  }
  addRemotesToShard(e, t) {
    return this.#r({ shards: { [e]: { addRemotes: t } } });
  }
  removeRemotesFromShard(e, t) {
    return this.#r({ shards: { [e]: { removeRemotes: t } } });
  }
  async getKeys(e) {
    let t = await this.httpRequest.get({
      path: "keys",
      params: e
    });
    return t.results = t.results.map((e2) => ({
      ...e2,
      createdAt: new Date(e2.createdAt),
      updatedAt: new Date(e2.updatedAt)
    })), t;
  }
  async getKey(e) {
    return await this.httpRequest.get({ path: `keys/${e}` });
  }
  async createKey(e) {
    return await this.httpRequest.post({
      path: "keys",
      body: e
    });
  }
  async updateKey(e, t) {
    return await this.httpRequest.patch({
      path: `keys/${e}`,
      body: t
    });
  }
  async deleteKey(e) {
    await this.httpRequest.delete({ path: `keys/${e}` });
  }
  async health() {
    return await this.httpRequest.get({ path: "health" });
  }
  async isHealthy() {
    try {
      let { status: e } = await this.health();
      return e === "available";
    } catch {
      return false;
    }
  }
  async getStats() {
    return await this.httpRequest.get({ path: "stats" });
  }
  async getVersion() {
    return await this.httpRequest.get({ path: "version" });
  }
  createDump() {
    return this.#n.post({ path: "dumps" });
  }
  createSnapshot() {
    return this.#n.post({ path: "snapshots" });
  }
  async renderTemplate(e) {
    return await this.httpRequest.post({
      path: "render-template",
      body: e
    });
  }
  async getExperimentalFeatures() {
    return await this.httpRequest.get({ path: "experimental-features" });
  }
  async updateExperimentalFeatures(e) {
    return await this.httpRequest.patch({
      path: "experimental-features",
      body: e
    });
  }
};

// ../web/src/lib/composition/searchQuery.ts
var FIELDS = {
  tag: { kind: "tag" },
  tags: { kind: "tag" },
  title: { kind: "text", attribute: "title" },
  description: { kind: "text", attribute: "description" },
  created: { kind: "date", attribute: "created_at_ts" },
  createdat: { kind: "date", attribute: "created_at_ts" },
  createdon: { kind: "date", attribute: "created_at_ts" },
  updated: { kind: "date", attribute: "updated_at_ts" },
  updatedat: { kind: "date", attribute: "updated_at_ts" },
  updatedon: { kind: "date", attribute: "updated_at_ts" }
};
var KEY_PATTERN = Object.keys(FIELDS).join("|");
var KEY_AT_START = new RegExp(`^(${KEY_PATTERN}):\\s*`, "i");
var KEY_AHEAD = new RegExp(`\\s(?:${KEY_PATTERN}):`, "i");
var DATE_RE = /^(>=|<=|>|<|=)?(\d{4})-(\d{2})-(\d{2})$/;
function quote(value) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
function dateFilters(attribute, raw) {
  const match = DATE_RE.exec(raw);
  if (match === null) return null;
  const [, op = "=", year, month, day] = match;
  const start = Date.UTC(Number(year), Number(month) - 1, Number(day));
  const parsed = new Date(start);
  if (parsed.getUTCMonth() !== Number(month) - 1 || parsed.getUTCDate() !== Number(day)) {
    return null;
  }
  const startTs = Math.floor(start / 1e3);
  const endTs = startTs + 86400;
  switch (op) {
    case ">":
      return [`${attribute} >= ${endTs}`];
    case ">=":
      return [`${attribute} >= ${startTs}`];
    case "<":
      return [`${attribute} < ${startTs}`];
    case "<=":
      return [`${attribute} < ${endTs}`];
    default:
      return [`${attribute} >= ${startTs}`, `${attribute} < ${endTs}`];
  }
}
function readValue(input, from) {
  if (input[from] === '"') {
    const close = input.indexOf('"', from + 1);
    if (close === -1) return { value: input.slice(from + 1).trim(), end: input.length };
    return { value: input.slice(from + 1, close).trim(), end: close + 1 };
  }
  const rest = input.slice(from);
  const next = KEY_AHEAD.exec(rest);
  const length = next === null ? rest.length : next.index;
  return { value: rest.slice(0, length).trim(), end: from + length };
}
function parseSearchQuery(raw) {
  const filters = [];
  const textAttributes = [];
  const textValues = [];
  const freeText = [];
  let i2 = 0;
  while (i2 < raw.length) {
    if (/\s/.test(raw[i2])) {
      i2++;
      continue;
    }
    const key = KEY_AT_START.exec(raw.slice(i2));
    if (key === null) {
      const next = raw.slice(i2).search(/\s/);
      const end2 = next === -1 ? raw.length : i2 + next;
      freeText.push(raw.slice(i2, end2));
      i2 = end2;
      continue;
    }
    const field = FIELDS[key[1].toLowerCase()];
    const { value, end } = readValue(raw, i2 + key[0].length);
    const consumed = raw.slice(i2, end);
    i2 = end;
    if (value === "") continue;
    if (field.kind === "tag") {
      filters.push(`tags = ${quote(value)}`);
    } else if (field.kind === "text") {
      if (!textAttributes.includes(field.attribute)) textAttributes.push(field.attribute);
      textValues.push(value);
    } else {
      const clauses = dateFilters(field.attribute, value);
      if (clauses === null) freeText.push(consumed.trim());
      else filters.push(...clauses);
    }
  }
  const text = [...textValues, ...freeText].map((part) => part.trim()).filter((part) => part !== "").join(" ").replace(/\s+/g, " ");
  return {
    text,
    filters,
    attributesToSearchOn: textAttributes.length > 0 ? textAttributes : void 0
  };
}

// ../web/src/lib/composition/searchIndex.ts
var INDEX_UID = "notes";
var DEFAULT_MEILI_URL = "http://127.0.0.1:7700";
var SEARCH_LIMIT = 50;
var configured = null;
var unavailableReason = null;
var synced = false;
function masterKey() {
  if (configured) return configured.apiKey;
  if (process.env.MEILI_MASTER_KEY) return process.env.MEILI_MASTER_KEY;
  try {
    return fs3.readFileSync(path4.join(DEFAULT_APP_DATA_DIR, "meili_master_key"), "utf-8").trim();
  } catch {
    return void 0;
  }
}
var client = null;
var indexReady = null;
function meiliHost() {
  return configured?.host ?? (process.env.MEILI_URL || DEFAULT_MEILI_URL);
}
function unavailableMessage() {
  return unavailableReason ?? `Search is unavailable. Is Meilisearch running at ${meiliHost()}?`;
}
function getClient() {
  client ??= new E({ host: meiliHost(), apiKey: masterKey() });
  return client;
}
async function waitFor(task) {
  const done = await task.waitTask();
  if (done.status !== "succeeded") {
    throw new Error(`Meilisearch task failed: ${done.error?.message ?? done.status}`);
  }
}
function toTimestamp(iso) {
  return Math.floor(new Date(iso).getTime() / 1e3);
}
function noteToDocument(note) {
  return {
    id: note.id,
    title: note.title,
    description: note.description,
    content: note.content,
    tags: tagsFromString(note.tags),
    created_at_ts: toTimestamp(note.createdAt),
    updated_at_ts: toTimestamp(note.updatedAt)
  };
}
function ensureIndex() {
  indexReady ??= (async () => {
    const meili = getClient();
    try {
      await meili.getIndex(INDEX_UID);
    } catch {
      await waitFor(meili.createIndex(INDEX_UID, { primaryKey: "id" }));
    }
    await waitFor(
      meili.index(INDEX_UID).updateSettings({
        searchableAttributes: ["title", "content", "description"],
        filterableAttributes: ["tags", "created_at_ts", "updated_at_ts"],
        sortableAttributes: ["updated_at_ts"]
      })
    );
  })().catch((error) => {
    indexReady = null;
    throw error;
  });
  return indexReady;
}
async function indexNote(note) {
  await ensureIndex();
  await getClient().index(INDEX_UID).addDocuments([noteToDocument(note)]);
}
async function deleteNoteFromIndex(id) {
  await ensureIndex();
  await getClient().index(INDEX_UID).deleteDocument(id);
}
async function reindexAll(notes) {
  await ensureIndex();
  const index = getClient().index(INDEX_UID);
  await waitFor(index.deleteAllDocuments());
  if (notes.length > 0) {
    await waitFor(index.addDocuments(notes.map(noteToDocument)));
  }
  synced = true;
}
async function searchNoteIds(query) {
  const parsed = parseSearchQuery(query);
  if (parsed.text === "" && parsed.filters.length === 0) return [];
  if (unavailableReason) throw new Error(unavailableReason);
  await ensureIndex();
  const index = getClient().index(INDEX_UID);
  if (!synced) {
    const notes = listNotes();
    if (notes.length > 0) await reindexAll(notes);
    synced = true;
  }
  const result = await index.search(parsed.text, {
    limit: SEARCH_LIMIT,
    filter: parsed.filters.length > 0 ? parsed.filters.join(" AND ") : void 0,
    attributesToSearchOn: parsed.attributesToSearchOn,
    // Without text there is no relevance to rank by; show the newest notes first.
    sort: parsed.text === "" ? ["updated_at_ts:desc"] : void 0
  });
  return [...new Set(result.hits.map((hit) => Number(hit.id)))];
}

// ../web/src/lib/composition/service.ts
var service_exports = {};
__export(service_exports, {
  addAttachmentFiles: () => addAttachmentFiles,
  createGroup: () => createGroup2,
  createNote: () => createNote2,
  deleteGroup: () => deleteGroup,
  deleteNote: () => deleteNote,
  findAttachmentFile: () => findAttachmentFile,
  initialSunTheme: () => initialSunTheme,
  listAttachments: () => listAttachments2,
  loadSettings: () => loadSettings,
  loadSunSchedule: () => loadSunSchedule,
  loadTrash: () => loadTrash,
  loadWorkspace: () => loadWorkspace,
  moveGroup: () => moveGroup2,
  moveNoteToGroup: () => moveNoteToGroup,
  permanentlyDeleteGroup: () => permanentlyDeleteGroup,
  permanentlyDeleteNote: () => permanentlyDeleteNote,
  readImage: () => readImage2,
  removeAttachment: () => removeAttachment2,
  renameGroup: () => renameGroup2,
  restoreGroup: () => restoreGroup2,
  restoreNote: () => restoreNote2,
  saveFavorites: () => saveFavorites,
  saveImage: () => saveImage,
  saveLayout: () => saveLayout,
  saveLocation: () => saveLocation,
  saveNoteContent: () => saveNoteContent,
  saveSettings: () => saveSettings,
  saveTheme: () => saveTheme,
  searchNotes: () => searchNotes,
  setMaxImageBytes: () => setMaxImageBytes
});
import fs6 from "node:fs";
import path7 from "node:path";

// ../web/src/lib/composition/attachments.ts
import crypto from "node:crypto";
import fs4 from "node:fs";
import path5 from "node:path";

// ../web/src/lib/composition/attachmentsRepo.ts
function fromRow2(row) {
  return {
    id: row.id,
    noteId: row.note_id,
    fileName: row.file_name,
    storedName: row.stored_name,
    size: row.size,
    createdAt: row.created_at
  };
}
function listAttachments(noteId) {
  const rows = getDb().prepare("SELECT * FROM attachments WHERE note_id = ? ORDER BY id").all(noteId);
  return rows.map(fromRow2);
}
function getAttachment(id) {
  const row = getDb().prepare("SELECT * FROM attachments WHERE id = ?").get(id);
  return row ? fromRow2(row) : null;
}
function addAttachment(noteId, fileName, storedName, size) {
  const result = getDb().prepare(
    `INSERT INTO attachments (note_id, file_name, stored_name, size, created_at)
       VALUES (?, ?, ?, ?, ?)`
  ).run(noteId, fileName, storedName, size, (/* @__PURE__ */ new Date()).toISOString());
  const attachment = getAttachment(Number(result.lastInsertRowid));
  if (!attachment) throw new Error("Failed to read back the attachment that was just added");
  return attachment;
}
function deleteAttachment(id) {
  getDb().prepare("DELETE FROM attachments WHERE id = ?").run(id);
}
function deleteOrphanedAttachments() {
  const db = getDb();
  return db.transaction(() => {
    const rows = db.prepare(
      `SELECT * FROM attachments
         WHERE note_id NOT IN (SELECT id FROM notes)
           AND note_id NOT IN (SELECT id FROM trashed_notes)`
    ).all();
    for (const row of rows) db.prepare("DELETE FROM attachments WHERE id = ?").run(row.id);
    return rows.map(fromRow2);
  })();
}

// ../web/src/lib/composition/attachments.ts
function attachmentDir(appDataDir) {
  return path5.join(appDataDir, ATTACHMENT_DIR_NAME);
}
async function addFiles(appDataDir, noteId, sourcePaths) {
  const dir = attachmentDir(appDataDir);
  const added2 = [];
  const errors = [];
  for (const source of sourcePaths) {
    const fileName = displayName(source);
    try {
      const stats = await fs4.promises.stat(source);
      if (!stats.isFile()) {
        errors.push(`${fileName}: only files can be attached, not folders.`);
        continue;
      }
      if (stats.size > MAX_ATTACHMENT_BYTES) {
        errors.push(`${fileName}: files can be at most ${formatBytes(MAX_ATTACHMENT_BYTES)}.`);
        continue;
      }
      const storedName = storedFileName(crypto.randomBytes(6).toString("hex"), fileName);
      const target = path5.join(dir, storedName);
      await fs4.promises.mkdir(dir, { recursive: true });
      const temporary = path5.join(dir, `.${storedName}.tmp`);
      try {
        await fs4.promises.copyFile(source, temporary);
        await fs4.promises.rename(temporary, target);
      } catch (error) {
        await fs4.promises.rm(temporary, { force: true });
        throw error;
      }
      try {
        added2.push(addAttachment(noteId, fileName, storedName, stats.size));
      } catch (error) {
        await fs4.promises.rm(target, { force: true });
        throw error;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${fileName}: could not be attached (${message}).`);
    }
  }
  return { added: added2, errors };
}
function attachmentPath(appDataDir, id) {
  const attachment = getAttachment(id);
  if (!attachment) return null;
  const file = path5.join(attachmentDir(appDataDir), attachment.storedName);
  return fs4.existsSync(file) ? { path: file, attachment } : null;
}
async function removeFiles(appDataDir, attachments) {
  const dir = attachmentDir(appDataDir);
  for (const { storedName } of attachments) {
    await fs4.promises.rm(path5.join(dir, storedName), { force: true }).catch(() => {
    });
  }
}
async function removeAttachment(appDataDir, id) {
  const attachment = getAttachment(id);
  if (!attachment) return false;
  deleteAttachment(id);
  await removeFiles(appDataDir, [attachment]);
  return true;
}
async function removeOrphans(appDataDir) {
  await removeFiles(appDataDir, deleteOrphanedAttachments());
}

// ../web/src/lib/composition/groupsRepo.ts
var GroupNotEmptyError = class extends Error {
};
var InvalidGroupMoveError = class extends Error {
};
function fromRow3(row) {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function nowIso2() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function listGroups() {
  const rows = getDb().prepare("SELECT * FROM groups ORDER BY name").all();
  return rows.map(fromRow3);
}
function getGroup(id) {
  const row = getDb().prepare("SELECT * FROM groups WHERE id = ?").get(id);
  return row ? fromRow3(row) : null;
}
function createGroup(name, parentId = null) {
  const now = nowIso2();
  const result = getDb().prepare(
    "INSERT INTO groups (name, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?)"
  ).run(name, parentId, now, now);
  const group = getGroup(Number(result.lastInsertRowid));
  if (!group) throw new Error("Failed to read back the group that was just created");
  return group;
}
function renameGroup(id, name) {
  getDb().prepare("UPDATE groups SET name = ?, updated_at = ? WHERE id = ?").run(name, nowIso2(), id);
}
function moveGroup(id, parentId) {
  if (!getGroup(id)) throw new InvalidGroupMoveError(`Group ${id} not found.`);
  if (parentId !== null && !getGroup(parentId)) {
    throw new InvalidGroupMoveError(`Group ${parentId} not found.`);
  }
  if (wouldCreateCycle(listGroups(), id, parentId)) {
    throw new InvalidGroupMoveError(
      `Group ${id} cannot be moved into itself or one of its sub-groups.`
    );
  }
  getDb().prepare("UPDATE groups SET parent_id = ?, updated_at = ? WHERE id = ?").run(parentId, nowIso2(), id);
}
function groupIsEmpty(id) {
  const db = getDb();
  const { count: childGroupCount } = db.prepare("SELECT COUNT(*) AS count FROM groups WHERE parent_id = ?").get(id);
  const { count: noteCount } = db.prepare("SELECT COUNT(*) AS count FROM notes WHERE group_id = ?").get(id);
  return childGroupCount === 0 && noteCount === 0;
}

// ../web/src/lib/composition/images.ts
import crypto2 from "node:crypto";
import fs5 from "node:fs";
import path6 from "node:path";
function imageDir(appDataDir) {
  return path6.join(appDataDir, IMAGE_DIR_NAME);
}
var startsWith = (data, bytes, offset = 0) => bytes.every((byte, i2) => data[offset + i2] === byte);
var ascii = (text) => [...text].map((c2) => c2.charCodeAt(0));
function sniffImage(data) {
  if (startsWith(data, [137, 80, 78, 71, 13, 10, 26, 10])) return "png";
  if (startsWith(data, [255, 216, 255])) return "jpg";
  if (startsWith(data, ascii("GIF87a")) || startsWith(data, ascii("GIF89a"))) return "gif";
  if (startsWith(data, ascii("RIFF")) && startsWith(data, ascii("WEBP"), 8)) return "webp";
  return null;
}
function slug(text, maxLength) {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, maxLength).replace(/-+$/g, "");
}
function imageFileName(noteTitle, fileName, data, ext) {
  const stem = (fileName.split(/[\\/]/).pop() ?? "").replace(/\.[^.]*$/, "");
  const hash = crypto2.createHash("sha256").update(data).digest("hex").slice(0, 12);
  return `${slug(noteTitle, 40) || "note"}-${slug(stem, 40) || "image"}-${hash}.${ext}`;
}
function storeImage(appDataDir, input, maxBytes = MAX_IMAGE_BYTES) {
  const { noteTitle, fileName, data } = input;
  if (data.byteLength === 0) return { error: "That image is empty." };
  if (maxBytes !== null && data.byteLength > maxBytes) {
    return { error: `Images can be at most ${maxBytes / (1024 * 1024)} MB.` };
  }
  const ext = sniffImage(data);
  if (!ext) return { error: "Only PNG, JPEG, GIF, and WebP images are supported." };
  const name = imageFileName(noteTitle, fileName, data, ext);
  const dir = imageDir(appDataDir);
  const target = path6.join(dir, name);
  try {
    fs5.mkdirSync(dir, { recursive: true });
    if (!fs5.existsSync(target)) {
      const temporary = path6.join(dir, `.${name}.tmp`);
      fs5.writeFileSync(temporary, data);
      fs5.renameSync(temporary, target);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: `Could not save the image: ${message}` };
  }
  return { name };
}
async function readImage(appDataDir, name) {
  if (!isImageName(name)) return null;
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  const contentType = IMAGE_CONTENT_TYPES[ext === "jpeg" ? "jpg" : ext];
  try {
    return { data: await fs5.promises.readFile(path6.join(imageDir(appDataDir), name)), contentType };
  } catch {
    return null;
  }
}

// ../web/src/lib/composition/trashRepo.ts
function nowIso3() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function trashNote(id) {
  const db = getDb();
  db.transaction(() => {
    db.prepare(
      `INSERT OR REPLACE INTO trashed_notes
         (id, title, content, tags, description, created_at, updated_at, group_id, deleted_at)
       SELECT id, title, content, tags, description, created_at, updated_at, group_id, ?
       FROM notes WHERE id = ?`
    ).run(nowIso3(), id);
    db.prepare("DELETE FROM notes WHERE id = ?").run(id);
  })();
}
function trashGroup(id) {
  const db = getDb();
  db.transaction(() => {
    if (!groupIsEmpty(id)) {
      throw new GroupNotEmptyError(
        `Group ${id} still has sub-groups or notes; empty it before deleting.`
      );
    }
    db.prepare(
      `INSERT OR REPLACE INTO trashed_groups
         (id, name, parent_id, created_at, updated_at, deleted_at)
       SELECT id, name, parent_id, created_at, updated_at, ?
       FROM groups WHERE id = ?`
    ).run(nowIso3(), id);
    db.prepare("DELETE FROM groups WHERE id = ?").run(id);
  })();
}
function listTrash() {
  const db = getDb();
  const notes = db.prepare("SELECT id, title, deleted_at FROM trashed_notes ORDER BY deleted_at DESC, id DESC").all();
  const groups = db.prepare("SELECT id, name, deleted_at FROM trashed_groups ORDER BY deleted_at DESC, id DESC").all();
  return {
    notes: notes.map((n2) => ({
      id: n2.id,
      title: n2.title,
      deletedAt: n2.deleted_at,
      expiresAt: expiryOf(n2.deleted_at)
    })),
    groups: groups.map((g2) => ({
      id: g2.id,
      name: g2.name,
      deletedAt: g2.deleted_at,
      expiresAt: expiryOf(g2.deleted_at)
    }))
  };
}
function restoreNote(id) {
  const db = getDb();
  return db.transaction(() => {
    const row = db.prepare("SELECT * FROM trashed_notes WHERE id = ?").get(id);
    if (!row) return null;
    const groupExists = row.group_id !== null && db.prepare("SELECT 1 FROM groups WHERE id = ?").get(row.group_id);
    const groupId = groupExists ? row.group_id : null;
    const idTaken = db.prepare("SELECT 1 FROM notes WHERE id = ?").get(id);
    db.prepare(
      `INSERT INTO notes (id, title, content, tags, description, created_at, updated_at, group_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      idTaken ? null : id,
      row.title,
      row.content,
      row.tags,
      row.description,
      row.created_at,
      row.updated_at,
      groupId
    );
    db.prepare("DELETE FROM trashed_notes WHERE id = ?").run(id);
    return { restoredToTopLevel: row.group_id !== null && groupId === null };
  })();
}
function restoreGroup(id) {
  const db = getDb();
  return db.transaction(() => {
    const row = db.prepare("SELECT * FROM trashed_groups WHERE id = ?").get(id);
    if (!row) return null;
    const parentExists = row.parent_id !== null && db.prepare("SELECT 1 FROM groups WHERE id = ?").get(row.parent_id);
    const parentId = parentExists ? row.parent_id : null;
    const idTaken = db.prepare("SELECT 1 FROM groups WHERE id = ?").get(id);
    db.prepare(
      `INSERT INTO groups (id, name, parent_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(idTaken ? null : id, row.name, parentId, row.created_at, row.updated_at);
    db.prepare("DELETE FROM trashed_groups WHERE id = ?").run(id);
    return { restoredToTopLevel: row.parent_id !== null && parentId === null };
  })();
}
function purgeNote(id) {
  getDb().prepare("DELETE FROM trashed_notes WHERE id = ?").run(id);
}
function purgeGroup(id) {
  getDb().prepare("DELETE FROM trashed_groups WHERE id = ?").run(id);
}
function purgeExpired(now = /* @__PURE__ */ new Date()) {
  const db = getDb();
  const cutoff = retentionCutoff(now);
  db.transaction(() => {
    db.prepare("DELETE FROM trashed_notes WHERE deleted_at < ?").run(cutoff);
    db.prepare("DELETE FROM trashed_groups WHERE deleted_at < ?").run(cutoff);
  })();
}

// ../web/src/lib/composition/sunTimes.ts
var GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
var FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
var REQUEST_TIMEOUT_MS = 3e3;
var CACHE_TTL_MS = 6 * 60 * 60 * 1e3;
var FAILURE_BACKOFF_MS = 2 * 60 * 1e3;
async function getJson(url, fetchImpl) {
  const response = await fetchImpl(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`Open-Meteo responded with ${response.status}`);
  return response.json();
}
async function geocodeCity(query, fetchImpl = fetch) {
  const url = new URL(GEOCODING_URL);
  url.search = new URLSearchParams({
    name: query,
    count: "1",
    language: "en",
    format: "json"
  }).toString();
  const data = await getJson(url, fetchImpl);
  const match = data.results?.[0];
  if (!match || typeof match.name !== "string" || typeof match.latitude !== "number" || typeof match.longitude !== "number" || typeof match.timezone !== "string") {
    return null;
  }
  const name = [match.name, match.admin1, match.country].filter((part) => Boolean(part)).join(", ");
  return { name, latitude: match.latitude, longitude: match.longitude, timezone: match.timezone };
}
var cacheKey = (location) => `${location.latitude},${location.longitude}`;
var cache = /* @__PURE__ */ new Map();
var inflight = /* @__PURE__ */ new Map();
async function fetchSunEvents(location, fetchImpl) {
  const url = new URL(FORECAST_URL);
  url.search = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    daily: "sunrise,sunset",
    // Epoch seconds: unambiguous no matter which timezone the city is in.
    timeformat: "unixtime",
    timezone: "auto",
    past_days: "1",
    forecast_days: "3"
  }).toString();
  const data = await getJson(url, fetchImpl);
  const events = [];
  for (const kind of ["sunrise", "sunset"]) {
    for (const seconds of data.daily?.[kind] ?? []) {
      if (typeof seconds === "number" && Number.isFinite(seconds)) {
        events.push({ at: seconds * 1e3, kind });
      }
    }
  }
  return events.sort((a2, b2) => a2.at - b2.at);
}
async function loadSunEvents(location, now = Date.now(), fetchImpl = fetch) {
  const key = cacheKey(location);
  const cached = cache.get(key);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) return cached.events;
  let request = inflight.get(key);
  if (!request) {
    request = fetchSunEvents(location, fetchImpl).then((events) => {
      cache.set(key, { fetchedAt: now, events });
      return events;
    }).catch(() => {
      const events = cached?.events ?? [];
      cache.set(key, { fetchedAt: now - CACHE_TTL_MS + FAILURE_BACKOFF_MS, events });
      return events;
    }).finally(() => inflight.delete(key));
    inflight.set(key, request);
  }
  return request;
}
function scheduleFrom(events, location, now) {
  if (events.length === 0) {
    const standIn = fallbackSunEvents(now);
    return { events: standIn, level: sunLevel(standIn, now), estimated: true, retry: Boolean(location) };
  }
  return { events, level: sunLevel(events, now), estimated: false, retry: false };
}
async function resolveSunSchedule(location, now = Date.now(), fetchImpl = fetch) {
  const events = location ? await loadSunEvents(location, now, fetchImpl) : [];
  return scheduleFrom(events, location, now);
}
function cachedSunSchedule(location, now = Date.now()) {
  const events = location ? cache.get(cacheKey(location))?.events ?? [] : [];
  return scheduleFrom(events, location, now);
}
function todaysSunTimes(events, timezone, now = Date.now()) {
  const dateKey = new Intl.DateTimeFormat("en-CA", { timeZone: timezone });
  const clock = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit"
  });
  const today = dateKey.format(now);
  const result = {};
  for (const event of events) {
    if (dateKey.format(event.at) === today) result[event.kind] = clock.format(event.at);
  }
  return result;
}

// ../web/src/lib/composition/service.ts
async function bestEffortIndex(work) {
  try {
    await work();
  } catch (error) {
    console.error("[search] indexing failed:", error);
  }
}
async function loadWorkspace() {
  const { sidebarWidth, editorRatio, favorites } = loadWebSettings();
  await purgeExpiredTrash();
  return {
    notes: listNotes(),
    groups: listGroups(),
    layout: { sidebarWidth, editorRatio },
    favorites
  };
}
function isWritableDir(dir) {
  try {
    fs6.accessSync(dir, fs6.constants.W_OK);
    return fs6.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}
async function loadSettings() {
  const settings2 = loadWebSettings();
  const dbPath = resolvedDbPath(settings2);
  const { location } = settings2;
  const dbExists = fs6.existsSync(dbPath);
  const trash = dbExists ? await loadTrash() : EMPTY_TRASH;
  return {
    theme: settings2.theme,
    appDataDir: settings2.appDataDir,
    dbPath,
    dbPathOverride: settings2.dbPath ?? "",
    derivedDbPath: defaultDatabasePath(settings2.appDataDir),
    dirWritable: isWritableDir(settings2.appDataDir),
    dbExists,
    trash,
    city: location?.name ?? "",
    sunTimes: location ? todaysSunTimes(await loadSunEvents(location), location.timezone) : void 0
  };
}
async function searchNotes(query) {
  try {
    const ids = await searchNoteIds(query);
    const hits = [];
    for (const id of ids) {
      const note = getNote(id);
      if (note) hits.push({ id: note.id, title: note.title, description: note.description });
    }
    return { hits };
  } catch (error) {
    console.error("[search] query failed:", error);
    return {
      hits: [],
      error: unavailableMessage()
    };
  }
}
async function saveNoteContent(noteId, content) {
  const [fm, body] = parse(content);
  if (fm === null) {
    updateNoteContent(noteId, content);
  } else {
    const previous = getNote(noteId);
    if (!previous) throw new Error(`Note ${noteId} not found`);
    const reconciled = {
      title: fm.title || previous.title,
      description: fm.description,
      tags: fm.tags,
      createdAt: fm.createdAt || previous.createdAt,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    const rendered = render(reconciled, body);
    updateNote(noteId, rendered, {
      title: reconciled.title,
      tags: tagsToString(reconciled.tags),
      description: reconciled.description
    });
  }
  const note = getNote(noteId);
  if (!note) throw new Error(`Note ${noteId} not found`);
  await bestEffortIndex(() => indexNote(note));
  return note;
}
var maxImageBytes = MAX_IMAGE_BYTES;
function setMaxImageBytes(bytes) {
  maxImageBytes = bytes;
}
async function saveImage({ noteId, fileName, data }) {
  const note = getNote(noteId);
  if (!note) return { error: "That note no longer exists." };
  return storeImage(loadWebSettings().appDataDir, { noteTitle: note.title, fileName, data }, maxImageBytes);
}
async function readImage2(name) {
  return readImage(loadWebSettings().appDataDir, name);
}
async function createNote2(title, groupId = null) {
  const note = createNote(title, "", groupId);
  await bestEffortIndex(() => indexNote(note));
  return note;
}
async function deleteNote(id) {
  trashNote(id);
  await bestEffortIndex(() => deleteNoteFromIndex(id));
}
async function removeOrphanedAttachments() {
  try {
    await removeOrphans(loadWebSettings().appDataDir);
  } catch (error) {
    console.error("[attachments] cleanup failed:", error);
  }
}
async function purgeExpiredTrash() {
  purgeExpired();
  await removeOrphanedAttachments();
}
var publicAttachment = ({ id, noteId, fileName, size, createdAt }) => ({
  id,
  noteId,
  fileName,
  size,
  createdAt
});
async function listAttachments2(noteId) {
  return listAttachments(noteId).map(publicAttachment);
}
async function addAttachmentFiles(noteId, paths) {
  if (!getNote(noteId)) return { attachments: [], error: "That note no longer exists." };
  const { added: added2, errors } = await addFiles(loadWebSettings().appDataDir, noteId, paths);
  return {
    attachments: added2.map(publicAttachment),
    ...errors.length > 0 && { error: errors.join(" ") }
  };
}
async function findAttachmentFile(id) {
  const found = attachmentPath(loadWebSettings().appDataDir, id);
  return found ? { path: found.path, fileName: found.attachment.fileName } : null;
}
async function removeAttachment2(id) {
  const removed = await removeAttachment(loadWebSettings().appDataDir, id);
  return removed ? {} : { error: "That attachment no longer exists." };
}
async function createGroup2(name, parentId) {
  return createGroup(name, parentId);
}
async function renameGroup2(id, name) {
  renameGroup(id, name);
  const group = getGroup(id);
  if (!group) throw new Error(`Group ${id} not found`);
  return group;
}
async function deleteGroup(id) {
  try {
    trashGroup(id);
  } catch (error) {
    if (error instanceof GroupNotEmptyError) {
      return { error: "This group still has sub-groups or notes \u2014 empty it first." };
    }
    throw error;
  }
  return {};
}
async function loadTrash() {
  await purgeExpiredTrash();
  return listTrash();
}
var NOT_IN_TRASH = "That item is no longer in the Trash Can.";
async function restoreNote2(id) {
  const restored = restoreNote(id);
  if (!restored) return { error: NOT_IN_TRASH };
  const note = getNote(id);
  if (note) await bestEffortIndex(() => indexNote(note));
  return restored;
}
async function restoreGroup2(id) {
  return restoreGroup(id) ?? { error: NOT_IN_TRASH };
}
async function permanentlyDeleteNote(id) {
  purgeNote(id);
  await removeOrphanedAttachments();
}
async function permanentlyDeleteGroup(id) {
  purgeGroup(id);
}
async function moveGroup2(id, parentId) {
  try {
    moveGroup(id, parentId);
  } catch (error) {
    if (error instanceof InvalidGroupMoveError) {
      return { error: "That group can't be moved there." };
    }
    throw error;
  }
  const group = getGroup(id);
  if (!group) throw new Error(`Group ${id} not found`);
  return { group };
}
async function moveNoteToGroup(noteId, groupId) {
  setNoteGroup(noteId, groupId);
  const note = getNote(noteId);
  if (!note) throw new Error(`Note ${noteId} not found`);
  return note;
}
async function saveLayout(layout) {
  saveWebSettings({
    ...loadWebSettings(),
    sidebarWidth: clampSidebarWidth(layout.sidebarWidth),
    editorRatio: clampEditorRatio(layout.editorRatio)
  });
}
async function saveFavorites(favorites) {
  saveWebSettings({ ...loadWebSettings(), favorites: parseFavorites(favorites) });
}
async function saveSettings(input) {
  const rawAppDataDir = input.appDataDir.trim();
  const rawDbPath = input.dbPath.trim();
  if (rawAppDataDir === "") {
    return { error: "Application data directory is required." };
  }
  const appDataDir = expandHome(rawAppDataDir);
  const dbPath = rawDbPath === "" ? void 0 : expandHome(rawDbPath);
  try {
    fs6.mkdirSync(appDataDir, { recursive: true });
    if (dbPath) {
      fs6.mkdirSync(path7.dirname(dbPath), { recursive: true });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: `Could not create or write to that location: ${message}` };
  }
  const settings2 = { ...loadWebSettings(), appDataDir, dbPath };
  saveWebSettings(settings2);
  closeDb();
  return {
    success: true,
    appDataDir,
    dbPath: resolvedDbPath(settings2)
  };
}
async function saveTheme(theme) {
  if (!isThemeName(theme)) {
    return { error: "Unknown color scheme." };
  }
  saveWebSettings({ ...loadWebSettings(), theme });
  return {};
}
async function saveLocation(city) {
  const query = city.trim();
  if (query === "") {
    const settings2 = loadWebSettings();
    delete settings2.location;
    saveWebSettings(settings2);
    return {};
  }
  let location;
  try {
    location = await geocodeCity(query);
  } catch {
    return { error: "Couldn't reach the city lookup service. Check your connection and try again." };
  }
  if (!location) {
    return {
      error: `Couldn't find a city matching "${query}". Try "City, State" or "City, Country".`
    };
  }
  saveWebSettings({ ...loadWebSettings(), location });
  const times = todaysSunTimes(await loadSunEvents(location), location.timezone);
  return { saved: { name: location.name, ...times } };
}
async function loadSunSchedule() {
  const { theme, location } = loadWebSettings();
  return theme === "auto" ? resolveSunSchedule(location) : null;
}
function initialSunTheme() {
  const { theme, location } = loadWebSettings();
  return theme === "auto" ? sunThemeAttributes(cachedSunSchedule(location).level) : void 0;
}

// src/tools/dummyNotes.ts
var LOREM_WORDS = [
  "lorem",
  "ipsum",
  "dolor",
  "sit",
  "amet",
  "consectetur",
  "adipiscing",
  "elit",
  "sed",
  "do",
  "eiusmod",
  "tempor",
  "incididunt",
  "ut",
  "labore",
  "et",
  "dolore",
  "magna",
  "aliqua",
  "enim",
  "ad",
  "minim",
  "veniam",
  "quis",
  "nostrud",
  "exercitation",
  "ullamco",
  "laboris",
  "nisi",
  "aliquip",
  "ex",
  "ea",
  "commodo",
  "consequat",
  "duis",
  "aute",
  "irure",
  "in",
  "reprehenderit",
  "voluptate",
  "velit",
  "esse",
  "cillum",
  "eu",
  "fugiat",
  "nulla",
  "pariatur",
  "excepteur",
  "sint",
  "occaecat",
  "cupidatat",
  "non",
  "proident",
  "sunt",
  "culpa",
  "qui",
  "officia",
  "deserunt",
  "mollit",
  "anim",
  "id",
  "est",
  "laborum"
];
var TECH_SNIPPETS = [
  "Kubernetes schedules containers across a cluster of nodes using a declarative model: you describe the desired state and the control plane continuously reconciles reality toward it. Pods are the smallest deployable unit, and controllers like Deployments manage rolling updates and self-healing.",
  "TCP establishes a reliable, ordered byte stream over an unreliable network using a three-way handshake (SYN, SYN-ACK, ACK). Congestion control algorithms like TCP Reno and CUBIC adjust the sending rate based on observed packet loss and round-trip time.",
  "React's reconciliation algorithm diffs the new virtual DOM tree against the previous one, computing a minimal set of mutations to apply to the real DOM. Keys help React match list items across renders so it can reuse existing DOM nodes instead of recreating them.",
  "Relational databases enforce ACID guarantees: atomicity, consistency, isolation, and durability. Isolation levels like read committed and serializable trade off concurrency for protection against anomalies such as dirty reads, non-repeatable reads, and phantom reads.",
  "Git represents history as a directed acyclic graph of commits, each pointing to a snapshot of the tree and its parent commit(s). Rebasing rewrites commit history by replaying commits onto a new base, while merging preserves history by creating a new merge commit.",
  "gRPC uses HTTP/2 as its transport, enabling multiplexed streams over a single connection, and Protocol Buffers for efficient binary serialization. Unlike REST, it supports bidirectional streaming RPCs natively, which suits real-time or high-throughput service meshes.",
  "Node's event loop runs callbacks cooperatively on a single thread, switching between tasks when one awaits rather than using preemptive OS-level scheduling. This avoids the overhead of thread context switches but requires all I/O in the call chain to be asynchronous.",
  "DNS resolution walks a hierarchy from root servers to TLD servers to authoritative nameservers, with resolvers caching responses according to each record's TTL. Anycast routing lets many physical DNS servers share one IP address, with the network routing queries to the nearest.",
  "WebAssembly is a low-level, sandboxed binary instruction format designed as a portable compilation target, letting languages like Rust and C++ run in browsers near-natively. Its linear memory model and lack of garbage collection keep the runtime predictable and fast.",
  "SQLite implements a full SQL engine as an embedded, serverless library backed by a single file on disk, using B-tree structures for tables and indexes and write-ahead logging (WAL) mode to allow concurrent readers alongside a single writer without blocking."
];
var TITLE_TEMPLATES = [
  "Notes on {topic}",
  "{topic} deep dive",
  "Understanding {topic}",
  "{topic} cheat sheet",
  "Thoughts on {topic}",
  "{topic} roadmap",
  "Intro to {topic}",
  "{topic} troubleshooting log"
];
var TOPICS = [
  "Kubernetes",
  "TCP/IP",
  "React",
  "PostgreSQL",
  "Git",
  "gRPC",
  "async/await",
  "DNS",
  "WebAssembly",
  "SQLite",
  "Docker",
  "Terraform",
  "GraphQL",
  "Redis",
  "Next.js",
  "Rust",
  "load balancing",
  "observability",
  "CI/CD pipelines",
  "event sourcing"
];
var TAGS_POOL = ["software", "infra", "networking", "database", "frontend", "backend"];
function randomFrom(seed) {
  let state = seed >>> 0;
  return () => {
    state = state + 1831565813 >>> 0;
    let t = state;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
var DAY_MS2 = 24 * 60 * 60 * 1e3;
function generateNotes(count2 = 100, seed = 42, now = Date.now()) {
  const random = randomFrom(seed);
  const int2 = (min, max) => min + Math.floor(random() * (max - min + 1));
  const pick = (items) => items[int2(0, items.length - 1)];
  const sample = (items, size) => {
    const pool = [...items];
    const out = [];
    for (let i2 = 0; i2 < size; i2++) out.push(pool.splice(int2(0, pool.length - 1), 1)[0]);
    return out;
  };
  const paragraph = (sentences = 3) => Array.from({ length: sentences }, () => {
    const words = Array.from({ length: int2(6, 14) }, () => pick(LOREM_WORDS));
    words[0] = words[0][0].toUpperCase() + words[0].slice(1);
    return `${words.join(" ")}.`;
  }).join(" ");
  return Array.from({ length: count2 }, () => {
    const topic = pick(TOPICS);
    const title = pick(TITLE_TEMPLATES).replace("{topic}", topic);
    const body = `${pick(TECH_SNIPPETS)}

${paragraph()}
`;
    const tags = sample(TAGS_POOL, int2(0, 2)).join(",");
    const createdAt = new Date(now - int2(0, 400) * DAY_MS2).toISOString();
    return { title, body, tags, createdAt };
  });
}

// src/tools/seedNotes.ts
async function seedNotes(notes = generateNotes()) {
  await service_exports.loadWorkspace();
  const db = new Database2(resolvedDbPath(loadWebSettings()));
  try {
    const insert = db.prepare(
      "INSERT INTO notes (title, content, tags, description, created_at, updated_at, group_id) VALUES (?, ?, ?, '', ?, ?, NULL)"
    );
    const insertAll = db.transaction((rows) => {
      for (const note of rows) {
        const content = frontmatter_exports.generate(note.title, {
          createdAt: note.createdAt,
          updatedAt: note.createdAt,
          tags: frontmatter_exports.tagsFromString(note.tags)
        }) + note.body;
        insert.run(note.title, content, note.tags, note.createdAt, note.createdAt);
      }
    });
    insertAll(notes);
  } finally {
    db.close();
  }
  return notes.length;
}

// src/tools/seed.ts
function option(name) {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : void 0;
}
var count = Number(option("count") ?? 100);
if (!Number.isInteger(count) || count < 1) {
  console.error("--count must be a whole number of at least 1.");
  process.exit(1);
}
var home = path8.resolve(option("home") ?? fs7.mkdtempSync(path8.join(os3.tmpdir(), "composition-seed-")));
var dataDir = path8.join(home, ".composition");
fs7.mkdirSync(dataDir, { recursive: true });
var settings = path8.join(home, ".composition-cli", "settings.json");
fs7.mkdirSync(path8.dirname(settings), { recursive: true });
fs7.writeFileSync(settings, JSON.stringify({ appDataDir: dataDir, theme: "dark" }));
process.env.COMPOSITION_SETTINGS_PATH = settings;
var added = await seedNotes(generateNotes(count));
console.log(`Added ${added} dummy notes to ${dataDir}.`);
console.log("Open them with:");
console.log(`  COMPOSITION_DEV_HOME=${home} pnpm dev`);
process.exit(0);
//# sourceMappingURL=seed.mjs.map
