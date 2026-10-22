import { failureFromResponse, failureFromThrown, notOllama, type Failure } from "./errors";

/**
 * Whether a model name would be run on Ollama's cloud (ollama.com) rather than on the server it is sent to.
 * This mirrors the rule in Ollama v0.40.4 (internal/modelref `parseSourceSuffix`): the text after the last
 * colon, trimmed and lowercased, is `cloud`, or has no slash and ends in `-cloud`. The server forwards such a
 * name to ollama.com even when no model of that name is installed, so the helper must refuse it by name.
 */
export function isCloudModelName(name: string): boolean {
  const at = name.lastIndexOf(":");
  if (at < 0) return false;
  const suffix = name.slice(at + 1).trim();
  const lower = suffix.toLowerCase();
  return lower === "cloud" || (!suffix.includes("/") && lower.endsWith("-cloud"));
}

export type ModelSummary = {
  name: string;
  /** Ollama's own text, like "7.6B" or "751.63M"; empty when the server did not say. */
  parameterSize: string;
  /** The model's largest context window in tokens, when it says. */
  contextLength: number | undefined;
  /** What `/api/show` lists: `completion`, `tools`, `thinking`, `insert`, `embedding` and so on. */
  capabilities: string[];
};

export type ModelList = { ok: true; models: ModelSummary[]; hiddenCloud: number } | ({ ok: false } & Failure);

type TagsEntry = {
  name?: unknown;
  remote_host?: unknown;
  remote_model?: unknown;
  details?: { parameter_size?: unknown };
};

type ShowReply = {
  capabilities?: unknown;
  model_info?: Record<string, unknown>;
};

const SHOW_AT_ONCE = 4;

async function postJson(url: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

function contextLengthOf(info: Record<string, unknown> | undefined): number | undefined {
  if (!info) return undefined;
  const key = Object.keys(info).find((k) => k.endsWith(".context_length"));
  const value = key === undefined ? undefined : info[key];
  return typeof value === "number" ? value : undefined;
}

/** Runs `work` over `items` a few at a time and returns the results in the order of `items`. */
async function mapInBatches<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await work(items[index]);
      }
    }),
  );
  return results;
}

/**
 * The models on the server that the helper can offer: those that can chat, and run on that server. Embedding-only
 * models are left out (they answer a chat with an error), and so is every model that would run on Ollama's cloud.
 */
export async function listModels(baseUrl: string, signal?: AbortSignal): Promise<ModelList> {
  try {
    const tagsResponse = await fetch(`${baseUrl}/api/tags`, { signal });
    if (!tagsResponse.ok) return { ok: false, ...(await failureFromResponse(tagsResponse, baseUrl)) };
    let tags: { models?: TagsEntry[] } | null;
    try {
      tags = (await tagsResponse.json()) as { models?: TagsEntry[] } | null;
    } catch (error) {
      if (signal?.aborted) throw error;
      return { ok: false, ...notOllama(baseUrl) };
    }
    if (typeof tags !== "object" || tags === null) return { ok: false, ...notOllama(baseUrl) };

    const entries = (Array.isArray(tags.models) ? tags.models : []).filter((m) => typeof m.name === "string");
    const isCloud = (m: TagsEntry) =>
      Boolean(m.remote_host) || Boolean(m.remote_model) || isCloudModelName(m.name as string);
    const local = entries.filter((m) => !isCloud(m));

    const shown = await mapInBatches(local, SHOW_AT_ONCE, async (entry): Promise<ModelSummary | undefined> => {
      try {
        const response = await postJson(`${baseUrl}/api/show`, { model: entry.name }, signal);
        if (!response.ok) return undefined;
        const show = (await response.json()) as ShowReply;
        const capabilities = Array.isArray(show.capabilities)
          ? show.capabilities.filter((c) => typeof c === "string")
          : [];
        if (!capabilities.includes("completion")) return undefined;
        return {
          name: entry.name as string,
          parameterSize: typeof entry.details?.parameter_size === "string" ? entry.details.parameter_size : "",
          contextLength: contextLengthOf(show.model_info),
          capabilities,
        };
      } catch (error) {
        // One model that cannot be read is left out; being stopped is not that.
        if (signal?.aborted) throw error;
        return undefined;
      }
    });

    return {
      ok: true,
      hiddenCloud: entries.length - local.length,
      models: shown.filter((m): m is ModelSummary => m !== undefined),
    };
  } catch (error) {
    return { ok: false, ...failureFromThrown(error, baseUrl) };
  }
}

export type ModelInfo =
  | {
      ok: true;
      /** True when the model would run on Ollama's cloud (or any other host) rather than on this server. */
      remote: boolean;
      contextLength: number | undefined;
      capabilities: string[];
    }
  | ({ ok: false } & Failure);

/**
 * What the server says about one model, to check before a conversation starts. A cloud name is answered without
 * asking: the server would forward the question to ollama.com.
 */
export async function modelInfo(baseUrl: string, model: string, signal?: AbortSignal): Promise<ModelInfo> {
  if (isCloudModelName(model)) return { ok: true, remote: true, contextLength: undefined, capabilities: [] };
  try {
    const response = await postJson(`${baseUrl}/api/show`, { model }, signal);
    if (!response.ok) return { ok: false, ...(await failureFromResponse(response, baseUrl, model)) };
    let show: (ShowReply & { remote_host?: unknown; remote_model?: unknown }) | null;
    try {
      show = (await response.json()) as typeof show;
    } catch (error) {
      if (signal?.aborted) throw error;
      return { ok: false, ...notOllama(baseUrl) };
    }
    if (typeof show !== "object" || show === null) return { ok: false, ...notOllama(baseUrl) };
    return {
      ok: true,
      remote: Boolean(show.remote_host) || Boolean(show.remote_model),
      contextLength: contextLengthOf(show.model_info),
      capabilities: Array.isArray(show.capabilities) ? show.capabilities.filter((c) => typeof c === "string") : [],
    };
  } catch (error) {
    return { ok: false, ...failureFromThrown(error, baseUrl) };
  }
}
