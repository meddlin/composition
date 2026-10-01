import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import Markdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { docHref, listDocs, readDoc, resolveDocLink } from "@/lib/composition/docs";
import { cn } from "@/lib/utils";

// Reads the docs directory from local disk on each request, so edits show up
// without a rebuild (see the note in app/page.tsx).
export const dynamic = "force-dynamic";

export default async function DocsPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug = [] } = await params;
  const docs = listDocs();
  const doc = readDoc(slug.map(decodeURIComponent));
  if (!doc) notFound();

  return (
    <div className="flex min-h-screen">
      <nav aria-label="Docs" className="w-64 shrink-0 bg-surface p-4">
        <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground hover:text-foreground">
          <Link href="/">
            <ArrowLeftIcon /> Back to notes
          </Link>
        </Button>
        <h1 className="mt-4 mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Docs
        </h1>
        <ul className="flex flex-col gap-0.5">
          {docs.map((entry) => {
            const current = entry.relPath === doc.entry.relPath;
            return (
              <li key={entry.relPath}>
                <Button
                  asChild
                  variant="ghost"
                  className={cn(
                    "h-auto w-full flex-col items-start gap-0 px-2 py-1.5 text-left whitespace-normal",
                    current && "bg-accent font-medium",
                  )}
                >
                  <Link href={docHref(entry)} aria-current={current ? "page" : undefined}>
                    {entry.title}
                    {entry.slug.length > 1 && (
                      <span className="block text-xs font-normal text-muted-foreground">
                        {entry.slug.slice(0, -1).join(" / ")}
                      </span>
                    )}
                  </Link>
                </Button>
              </li>
            );
          })}
        </ul>
      </nav>
      <main className="min-w-0 flex-1 overflow-y-auto p-8">
        <article className="prose mx-auto max-w-3xl">
          <Markdown
            remarkPlugins={[remarkGfm]}
            // detect: false keeps fences without a language tag as plain text.
            rehypePlugins={[[rehypeHighlight, { detect: false }]]}
            components={{
              a({ href = "", children }) {
                const internal = resolveDocLink(doc.entry, href, docs);
                if (internal) return <Link href={internal}>{children}</Link>;
                // Links into the source tree mean nothing in the browser.
                if (!/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(href)) return <span>{children}</span>;
                return <a href={href}>{children}</a>;
              },
            }}
          >
            {doc.content}
          </Markdown>
        </article>
      </main>
    </div>
  );
}
