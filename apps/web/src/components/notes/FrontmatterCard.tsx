import { Badge } from "@/components/ui/badge";
import type { Frontmatter } from "@/lib/composition/frontmatter";

// Fixed-format (UTC) so server and client render the same text — a locale- or
// timezone-dependent format would cause a hydration mismatch.
function formatDate(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

export function FrontmatterCard({ fm }: { fm: Frontmatter }) {
  const created = formatDate(fm.createdAt);
  const updated = formatDate(fm.updatedAt);

  return (
    <header className="not-prose mb-6 border-b pb-4">
      <h1 className="text-2xl font-semibold tracking-tight">{fm.title.trim() || "Untitled"}</h1>
      {fm.description.trim() && (
        <p className="mt-2 text-sm text-muted-foreground">{fm.description}</p>
      )}
      {fm.tags.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Tags">
          {fm.tags.map((tag) => (
            <li key={tag}>
              <Badge variant="outline" className="text-muted-foreground">
                {tag}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {(created || updated) && (
        <p className="mt-3 text-xs text-muted-foreground">
          {[created && `Created ${created}`, updated && `Updated ${updated}`]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
    </header>
  );
}
