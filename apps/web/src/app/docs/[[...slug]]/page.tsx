import Link from "next/link";
import { notFound } from "next/navigation";
import Markdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { docHref, listDocs, readDoc, resolveDocLink } from "@/lib/composition/docs";

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
        <Link href="/" className="text-sm text-foreground/60 hover:text-foreground">
          ← Back to notes
        </Link>
        <h1 className="mt-4 mb-2 text-xs font-medium uppercase tracking-wide text-foreground/50">
          Docs
        </h1>
        <ul className="flex flex-col gap-0.5">
          {docs.map((entry) => (
            <li key={entry.relPath}>
              <Link
                href={docHref(entry)}
                aria-current={entry.relPath === doc.entry.relPath ? "page" : undefined}
                className={`block rounded-md px-2 py-1.5 text-sm hover:bg-foreground/5 ${
                  entry.relPath === doc.entry.relPath ? "bg-foreground/10 font-medium" : ""
                }`}
              >
                {entry.title}
                {entry.slug.length > 1 && (
                  <span className="block text-xs font-normal text-foreground/50">
                    {entry.slug.slice(0, -1).join(" / ")}
                  </span>
                )}
              </Link>
            </li>
          ))}
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
