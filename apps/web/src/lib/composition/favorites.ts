/**
 * Pinned groups and notes, shown in the sidebar's Favorites section in the
 * order they were pinned. Kept in the web settings file rather than the
 * database: the CLI builds its models straight from `SELECT *`, so a new
 * column would break it.
 */

export type FavoriteType = "group" | "note";

export type Favorite = { type: FavoriteType; id: number };

export type Favorites = Favorite[];

export const NO_FAVORITES: Favorites = [];

export function isFavorite(favorites: Favorites, type: FavoriteType, id: number): boolean {
  return favorites.some((f) => f.type === type && f.id === id);
}

/** Pins the item at the end of the list, or unpins it if it was already pinned. */
export function toggleFavorite(favorites: Favorites, type: FavoriteType, id: number): Favorites {
  return isFavorite(favorites, type, id)
    ? removeFavorite(favorites, type, id)
    : [...favorites, { type, id }];
}

export function removeFavorite(favorites: Favorites, type: FavoriteType, id: number): Favorites {
  return favorites.filter((f) => !(f.type === type && f.id === id));
}

/**
 * Whatever came off disk or over the wire, reduced to well-formed entries with
 * duplicates dropped. Never throws: a hand-edited settings file just loses the
 * entries that make no sense.
 */
export function parseFavorites(value: unknown): Favorites {
  if (!Array.isArray(value)) return [];
  const result: Favorites = [];
  for (const entry of value) {
    const { type, id } = (entry ?? {}) as Partial<Record<keyof Favorite, unknown>>;
    if (type !== "group" && type !== "note") continue;
    if (!Number.isSafeInteger(id)) continue;
    if (isFavorite(result, type, id as number)) continue;
    result.push({ type, id: id as number });
  }
  return result;
}
