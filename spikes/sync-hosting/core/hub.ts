// Answers "has anything changed?" from memory. With one API process (design: "Answer 'anything new?' from
// memory"), a push publishes the new head here and every connected device of that user gets a hint without
// a database read. A second API process would need a shared signal.

import type { Hint } from "../protocol/types.ts";

type Listener = (hint: Hint) => void;

export class HintHub {
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly heads = new Map<string, number>();

  subscribe(userId: string, listener: Listener): () => void {
    let set = this.listeners.get(userId);
    if (!set) this.listeners.set(userId, (set = new Set()));
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(userId);
    };
  }

  /** The head this process last published for a user, if any. */
  knownHead(userId: string): number | undefined {
    return this.heads.get(userId);
  }

  publish(userId: string, head: number, epoch: string): void {
    const prev = this.heads.get(userId) ?? 0;
    // A retry or replay does not move the head; only tell devices when it did.
    if (head <= prev && this.heads.has(userId)) return;
    this.heads.set(userId, head);
    for (const listener of this.listeners.get(userId) ?? []) listener({ head, epoch });
  }

  connectedUsers(): string[] {
    return [...this.listeners.keys()];
  }

  /** Tell a user's connected devices something, even if the head did not move (an epoch change). */
  emit(userId: string, hint: Hint): void {
    this.heads.set(userId, hint.head);
    for (const listener of this.listeners.get(userId) ?? []) listener(hint);
  }

  /** After a reset or an epoch change the remembered heads are meaningless. */
  forget(userId?: string): void {
    if (userId === undefined) this.heads.clear();
    else this.heads.delete(userId);
  }

  connections(): number {
    let n = 0;
    for (const set of this.listeners.values()) n += set.size;
    return n;
  }
}
