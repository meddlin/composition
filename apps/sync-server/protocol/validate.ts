// Request validation for POST /v1/sync.
// Everything here is cheap and structural: the server never looks inside a payload.

import { decodeBase64 } from "./b64.ts";
import {
  LIMITS,
  MIN_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  type ParsedChange,
  type ParsedSyncRequest,
} from "./types.ts";

export class ProtocolError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const ENTITY = /^[a-z][a-z_]{0,31}$/;
const UUID = /^[0-9a-f]{32}$/;
const BATCH_ID = /^[A-Za-z0-9_-]{8,64}$/;
const EPOCH = /^[A-Za-z0-9_-]{8,64}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function nonNegInt(v: unknown, name: string): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) {
    throw new ProtocolError(400, "invalid_request", `${name} must be a non-negative integer`);
  }
  return v;
}

export function parseSyncRequest(body: unknown): ParsedSyncRequest {
  if (!isRecord(body)) throw new ProtocolError(400, "invalid_request", "body must be a JSON object");

  const protocolVersion = nonNegInt(body.protocolVersion, "protocolVersion");
  if (protocolVersion < MIN_PROTOCOL_VERSION) {
    throw new ProtocolError(426, "protocol_too_old", `protocolVersion ${protocolVersion} is below ${MIN_PROTOCOL_VERSION}`);
  }
  if (protocolVersion > PROTOCOL_VERSION) {
    throw new ProtocolError(400, "protocol_unknown", `protocolVersion ${protocolVersion} is newer than ${PROTOCOL_VERSION}`);
  }

  const batchId = body.batchId;
  if (typeof batchId !== "string" || !BATCH_ID.test(batchId)) {
    throw new ProtocolError(400, "invalid_request", "batchId must be 8-64 chars of [A-Za-z0-9_-]");
  }

  const cursor = nonNegInt(body.cursor, "cursor");

  let epoch: string | undefined;
  if (body.epoch !== undefined) {
    if (typeof body.epoch !== "string" || !EPOCH.test(body.epoch)) {
      throw new ProtocolError(400, "invalid_request", "epoch must be a string id");
    }
    epoch = body.epoch;
  }

  let deviceId: string | undefined;
  if (body.deviceId !== undefined) {
    if (typeof body.deviceId !== "string" || body.deviceId.length > 64) {
      throw new ProtocolError(400, "invalid_request", "deviceId must be a short string");
    }
    deviceId = body.deviceId;
  }

  let pullLimit: number = LIMITS.defaultPullLimit;
  if (body.pullLimit !== undefined) {
    pullLimit = nonNegInt(body.pullLimit, "pullLimit");
    if (pullLimit > LIMITS.maxPullLimit) pullLimit = LIMITS.maxPullLimit;
  }

  if (!Array.isArray(body.changes)) throw new ProtocolError(400, "invalid_request", "changes must be an array");
  if (body.changes.length > LIMITS.maxBatchRecords) {
    throw new ProtocolError(413, "batch_too_large", `at most ${LIMITS.maxBatchRecords} changes per push`);
  }

  const seen = new Set<string>();
  const changes: ParsedChange[] = [];
  let bytes = 0;
  for (const raw of body.changes) {
    if (!isRecord(raw)) throw new ProtocolError(400, "invalid_request", "each change must be an object");
    const { entity, uuid } = raw;
    if (typeof entity !== "string" || !ENTITY.test(entity)) {
      throw new ProtocolError(400, "invalid_request", "entity must match [a-z][a-z_]{0,31}");
    }
    if (typeof uuid !== "string" || !UUID.test(uuid)) {
      throw new ProtocolError(400, "invalid_request", "uuid must be 32 lowercase hex chars");
    }
    const key = `${entity}/${uuid}`;
    if (seen.has(key)) throw new ProtocolError(400, "duplicate_in_batch", `${key} appears twice in one push`);
    seen.add(key);

    const baseVersion = nonNegInt(raw.baseVersion, "baseVersion");
    const schemaVersion = nonNegInt(raw.schemaVersion, "schemaVersion");
    if (schemaVersion < 1 || schemaVersion > 65535) {
      throw new ProtocolError(400, "invalid_request", "schemaVersion must be 1..65535");
    }
    if (typeof raw.deleted !== "boolean") throw new ProtocolError(400, "invalid_request", "deleted must be a boolean");
    if (typeof raw.payload !== "string") throw new ProtocolError(400, "invalid_request", "payload must be a base64 string");
    // Cheap size check before decoding.
    if (raw.payload.length > Math.ceil((LIMITS.maxRecordBytes * 4) / 3) + 4) {
      throw new ProtocolError(413, "record_too_large", `a record may hold at most ${LIMITS.maxRecordBytes} bytes`);
    }
    const payload = decodeBase64(raw.payload);
    if (payload === null) throw new ProtocolError(400, "invalid_request", "payload is not valid base64");
    if (payload.length > LIMITS.maxRecordBytes) {
      throw new ProtocolError(413, "record_too_large", `a record may hold at most ${LIMITS.maxRecordBytes} bytes`);
    }
    bytes += payload.length;
    if (bytes > LIMITS.maxBatchBytes) {
      throw new ProtocolError(413, "batch_too_large", `a push may carry at most ${LIMITS.maxBatchBytes} payload bytes`);
    }
    changes.push({ entity, uuid, baseVersion, deleted: raw.deleted, schemaVersion, payload });
  }

  return { protocolVersion, deviceId, batchId, cursor, epoch, changes, pullLimit };
}
