This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Search

The search bar at the top of the UI queries a Meilisearch index (`notes`, the same
index the CLI uses; see [docs/architecture/search.md](../../docs/architecture/search.md)).
The web app does not start Meilisearch itself. One command runs both it and the dev server
(Ctrl-C stops both):

```bash
pnpm dev:all
```

Or run them separately: `pnpm meili` (Meilisearch on 127.0.0.1:7700, data in
`~/.composition-web/meili_data`) in one terminal and `pnpm dev` in another.

No `.env` file is needed for that setup. To use a different instance, set these
(e.g. in `.env.local`) and restart `pnpm dev`; starting Meilisearch after the app is
already running needs no restart.

| Variable | Default |
|---|---|
| `MEILI_URL` | `http://127.0.0.1:7700` |
| `MEILI_MASTER_KEY` | contents of `~/.composition/meili_master_key` |

The first search rebuilds the index from SQLite if it is empty. If Meilisearch is
unreachable, the search dropdown says so and editing is unaffected.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
