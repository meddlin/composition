import type { ChatEvent, ChatRequest } from "./assistant/types";

/**
 * What the desktop renderer and main process exchange to run the AI helper's chat. Types and small pure helpers
 * only, so it is safe to import anywhere (renderer, preload, main). The web app uses a route handler instead.
 *
 * The renderer never supplies a server address: the main process reads the saved one. Events are pushed to the
 * window that asked, tagged with the request id the renderer chose, so a page can follow several turns at once.
 */
export interface AssistantStreamApi {
  /** Runs one turn. Resolves once it has ended; its events arrive through `onAssistantEvent`. */
  assistantChat(requestId: string, request: ChatRequest): Promise<void>;
  /** Stops the turn with that id, if it is still running. */
  assistantAbort(requestId: string): Promise<void>;
}

export const ASSISTANT_METHODS = ["assistantChat", "assistantAbort"] as const satisfies readonly (keyof AssistantStreamApi)[];

export type AssistantMethod = (typeof ASSISTANT_METHODS)[number];

type MissingFromAssistantMethods = Exclude<keyof AssistantStreamApi, AssistantMethod>;
const _everyMethodListed: [MissingFromAssistantMethods] extends [never] ? true : never = true;
void _everyMethodListed;

/** One event of one turn, as pushed from the main process. */
export type AssistantEventMessage = { requestId: string; event: ChatEvent };

export type AssistantEventListener = (message: AssistantEventMessage) => void;

const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Request ids are chosen by the page, so the main process only accepts short, plain ones. */
export const isRequestId = (value: unknown): value is string => typeof value === "string" && REQUEST_ID.test(value);
