# Cross-device sync: price and cost

A price-to-cost projection for the hosted sync service ([design](cross-device-sync-design.md)), written to answer: can it
be offered at $1 to $3 a month, or a flat $20 a year, when Obsidian and Bear charge about $4 to $5? **These are
estimates, not advice.** Prices were read from each vendor's own page on 2026-11-05, nothing has been tried under load,
and every figure is **before income tax and before your own time**. Dates are 2026-11-05.

Two ways of running the service are compared throughout. **Lean:** the sync server and its database run on one small
VM, the database is a file on that VM's disk copied continuously to object storage, and sign-in uses Clerk's free Hobby
plan. **Comfort:** the database is managed Postgres with failover, run by a provider, and sign-in uses Clerk's paid Pro
plan. Lean and comfort match the SQLite and Postgres options in [D3](cross-device-sync-design.md#decisions). The Clerk plan
is a separate choice that the tables happen to bundle into Comfort; the fixed-cost table also shows Lean with Clerk Pro. A
rough third setup, Convex, follows the comfort projections.

## The answer

- **Yes at $2 to $3 a month or $20 a year. $1 a month is the weak spot.** Running the service is cheap; taking the money
  is not. Per subscriber, storage costs under $0.08 a month even for someone filling a 5 GB allowance. But
  every charge carries a fixed fee, so a payment takes 15% to 55% of a $1 monthly plan (35% on my
  base mix). It still shows a profit on the lean setup, and loses money at 50 subscribers on the comfortable one.
- **Bill yearly if you can.** At $20 a year, payment costs are 5% to 15% of the price depending on where the person pays.
  At $1 a month they are 15% to 55%.
- **At your expected size, this pays its way and little more.** On the lean setup, $20 a year earns about
  $63 a month at 50 subscribers and $137 at 100 ($1,641 a year, a margin of
  82%). At 1,000 it would earn about $1,446 a month. It is a modest side income at 100, not
  a living.
- **A $27 a year plan ($2.25 a month) earns about $52 more a month than $20 at 100 subscribers.** On
  the lean setup it makes $89 a month at 50 subscribers, $189 at 100 and $1,971 at 1,000. It
  breaks even at 6 subscribers on the lean setup, 16 with Clerk Pro, and 23 on the comfortable setup.
- **The fixed lines set the break-even.** Break-even on $20 a year is
  **8 subscribers** on the lean setup, **21** if you also pay for Clerk Pro, and **31** on the
  comfortable setup (managed Postgres with failover, plus Clerk Pro). At $20 a year and 50 or more subscribers, none of the
  three setups loses money.
- **Apple takes a share you cannot avoid** if the iPad app unlocks sync (see [Apple's rules](#apples-rules)).

## What others charge

| Service | Price | How it runs |
|---|---|---|
| **Obsidian Sync** | $5 a month, or $4 a month billed yearly ($48 a year) | Runs its own servers, so it is the fair comparison. The pricing page I read lists no storage or vault limits. |
| **Bear Pro** | $2.99 a month or $29.99 a year | Syncs through the user's iCloud, so Bear runs **no sync servers**. Its price is not a benchmark for a server's cost. |

The "$4 to $5" you saw matches Obsidian Sync. Bear is lower, and can be, because Apple carries the sync.

## What it costs to run

### Fixed costs by month

| Line | 50 | 100 | 1,000 |
|---|--:|--:|--:|
| Sync API host (Fly, 512 MB; 1 GB at 1,000) | $4.39 | $4.39 | $8.78 |
| Lean: database file on a Fly volume | $0.15 | $0.15 | $1.50 |
| Comfort: managed Postgres with failover (PlanetScale three-node) | $15.00 | $15.00 | $30.00 |
| Blob storage on R2 (0.5 GB each on average, first 10 GB free) | $0.22 | $0.60 | $7.35 |
| Domain | $1.00 | $1.00 | $1.00 |
| Bandwidth, monitoring and the unforeseen (assumed) | $5.00 | $5.00 | $15.00 |
| Clerk Hobby | $0 | $0 | $0 |
| Clerk Pro (billed yearly) | $20 | $20 | $20 |
| **Lean total** (Clerk Hobby) | **$10.77** | **$11.14** | **$33.63** |
| **Lean total** with Clerk Pro | **$30.77** | **$31.14** | **$53.63** |
| **Comfort total** (managed Postgres, Clerk Pro) | **$45.62** | **$45.99** | **$82.13** |

**Lean** means the sync server keeps its records in a database file on a small VM, replicated to object storage (D3's
SQLite option). The same figures hold for managed Postgres on Neon's free plan while the records fit in 1 GB, which
covers roughly 100 subscribers at 10 MB each. **Comfort** means managed Postgres with failover. Heavy use, where every
subscriber fills a 5 GB blob allowance, adds $3, $7 and $68 a month at 50, 100
and 1,000 subscribers.

### Clerk

Clerk's **Hobby** plan is free up to 50,000 monthly retained users, which is far more than you expect. It has no passkeys,
no branding removal and no multi-factor sign-in. **Pro** is $25 a month, or $20 billed yearly, and adds those. Pro is the
largest fixed line on the lean setup: it takes the monthly bill from about $11 to $31 at 100
subscribers. Because the design
uses Clerk only for the sign-in step, its short sessions do not matter. A reasonable start is Hobby with an emailed code and
Sign in with Apple, and Pro only if passkeys matter to you (to confirm in spike S4, including what Hobby allows).

### Payments

Each fee below is per subscriber per year, with the share of the price in brackets.

| Plan | Apple in-app purchase (15%) | Stripe (3.6% + 30¢) | Paddle, merchant of record (5% + 50¢) |
|---|--:|--:|--:|
| $1 a month (billed monthly) | $1.80 (15%) | $4.03 (34%) | $6.60 (55%) |
| $2 a month (billed monthly) | $3.60 (15%) | $4.46 (19%) | $7.20 (30%) |
| $3 a month (billed monthly) | $5.40 (15%) | $4.90 (14%) | $7.80 (22%) |
| **$20 a year** (billed yearly) | $3.00 (15%) | $1.02 (5%) | $1.50 (8%) |
| **$27 a year** (billed yearly, $2.25 a month) | $4.05 (15%) | $1.27 (5%) | $1.85 (7%) |
| $4 a month billed yearly = $48 a year (Obsidian Sync) | $7.20 (15%) | $2.03 (4%) | $2.90 (6%) |

- **A fixed fee per charge punishes small monthly plans.** Stripe's 30¢ and Paddle's 50¢ are paid on every monthly
  charge, which is why $1 a month loses 34% to 55%. **Apple's flat 15% is the cheapest way to collect $1 to $3 a month,**
  and the dearest way to collect a yearly fee.
- **Stripe does not handle tax; Paddle does.** Paddle is a merchant of record: it collects and files sales tax and VAT.
  With Stripe you do that yourself, and as I understand it a seller outside the EU owes EU VAT on digital services from
  the first sale (confirm with an accountant). That is why the base case uses Paddle. Paddle's page says products under
  $10 need bespoke pricing, so the $1 to $3 monthly rows are an upper bound on what it would accept.
- **Apple's 15% assumes the Small Business Program** (proceeds up to $1 million a year). Its page hints at a lower rate for
  subscriptions after the first year; I used 15% throughout.

## Assumptions

- Every user pays. If only some do, divide the revenue by the paying share; free and trial users add cost but little.
- **Half of subscribers pay through the web** (Paddle) and **half through Apple in-app purchase.** Other mixes are in the
  [sensitivity table](#what-moves-the-answer).
- Each subscriber holds 10 MB of encrypted records and 0.5 GB of images and attachments on average.
- Prices exclude tax; refunds, chargebacks and free trials are ignored.
- The Apple Developer Program ($99 a year) is not counted: you need it for the iPad app anyway.

## Projections

Monthly profit for the whole service (not per subscriber), after payment fees and all fixed costs. A minus sign is a loss.
Multiply by 12 for a year.

### Lean setup, Clerk Hobby

| Price | 50 subscribers | 100 subscribers | 1,000 subscribers |
|---|--:|--:|--:|
| $1 a month (billed monthly) | $22 | $54 | $616 |
| $2 a month (billed monthly) | $67 | $144 | $1,516 |
| $3 a month (billed monthly) | $112 | $234 | $2,416 |
| **$20 a year** (billed yearly) | $63 | $137 | $1,446 |
| **$27 a year** (billed yearly, $2.25 a month) | $89 | $189 | $1,971 |
| $4 a month billed yearly = $48 a year (Obsidian Sync) | $168 | $347 | $3,546 |

At $20 a year, that is $758, $1,641 and $17,346 a year at 50, 100 and 1,000 subscribers. At $27 a year it is
$1,073, $2,271 and $23,646.

### Comfort setup: managed Postgres with failover, Clerk Pro

| Price | 50 subscribers | 100 subscribers | 1,000 subscribers |
|---|--:|--:|--:|
| $1 a month (billed monthly) | −$13 | $19 | $568 |
| $2 a month (billed monthly) | $32 | $109 | $1,468 |
| $3 a month (billed monthly) | $77 | $199 | $2,368 |
| **$20 a year** (billed yearly) | $28 | $102 | $1,397 |
| **$27 a year** (billed yearly, $2.25 a month) | $55 | $154 | $1,922 |
| $4 a month billed yearly = $48 a year (Obsidian Sync) | $133 | $312 | $3,497 |

At $20 a year, that is $340, $1,223 and $16,764 a year at 50, 100 and 1,000 subscribers; at $27 a year it is
$655, $1,853 and $23,064. Compared with the lean
setup, the comfort setup costs about $418 a year at 100 subscribers, which is what you pay for
managed failover and Clerk's extra sign-in features.

### Convex setup (rough)

A third candidate for the hosted service ([Convex as the hosted server](cross-device-sync-design.md#convex-as-the-hosted-server)):
a hosted backend with no machine and no database for you to run. Blobs stay on R2 and sign-in is Clerk Hobby. The Convex bill
is a usage estimate on the Starter plan's pay-as-you-go rates, assuming about 3,000 function calls, 10 MB of records and
20 MB of bandwidth per subscriber a month. Backups, export and production terms on that plan are unconfirmed, so treat this
as a sketch, not a quote.

| Line | 50 | 100 | 1,000 |
|---|--:|--:|--:|
| Convex usage (Starter, pay-as-you-go; estimate) | $0.00 | $0.24 | $9.00 |
| Blob storage on R2 | $0.22 | $0.60 | $7.35 |
| Domain | $1.00 | $1.00 | $1.00 |
| Monitoring and the unforeseen (assumed) | $5.00 | $5.00 | $15.00 |
| Clerk Hobby | $0 | $0 | $0 |
| **Convex total** | **$6.22** | **$6.84** | **$32.35** |
| For comparison: lean total (Clerk Hobby) | $10.77 | $11.14 | $33.63 |

Monthly profit on the same base payment mix as above:

| Price | 50 subscribers | 100 subscribers | 1,000 subscribers | Break-even |
|---|--:|--:|--:|--:|
| **$20 a year** (billed yearly) | $68 | $141 | $1,447 | 5 |
| **$27 a year** (billed yearly, $2.25 a month) | $94 | $194 | $1,972 | 3 |

On these assumptions Convex costs less than lean at small sizes (there is no host to pay for) and about the same at 1,000
subscribers. Its advantage is nothing to run, not a lower bill.

### Break-even: subscribers needed

| Price | Lean, Clerk Hobby | Lean, Clerk Pro | Comfort (managed Postgres, Clerk Pro) |
|---|--:|--:|--:|
| $1 a month (billed monthly) | 17 | 48 | 71 |
| $2 a month (billed monthly) | 7 | 20 | 30 |
| $3 a month (billed monthly) | 5 | 13 | 19 |
| **$20 a year** (billed yearly) | 8 | 21 | 31 |
| **$27 a year** (billed yearly, $2.25 a month) | 6 | 16 | 23 |
| $4 a month billed yearly = $48 a year (Obsidian Sync) | 3 | 9 | 13 |

## What moves the answer

| Price (100 subscribers, lean) | Half Paddle, half Apple (base) | Half Stripe, half Apple | All Apple | All Paddle |
|---|--:|--:|--:|--:|
| $1 a month (billed monthly) | $54 | $65 | $74 | $34 |
| $2 a month (billed monthly) | $144 | $155 | $159 | $129 |
| $3 a month (billed monthly) | $234 | $246 | $244 | $224 |
| **$20 a year** (billed yearly) | $137 | $139 | $131 | $143 |
| **$27 a year** (billed yearly, $2.25 a month) | $189 | $192 | $180 | $198 |

- **The payment route matters little at $20 a year** (about $12 a month across the four mixes at 100 subscribers) **and a lot
  at $1 a month** (about $40).
- **Heavy storage is a small risk at your size** ($7 a month at 100 subscribers) and a real one at 1,000
  ($68). Per-account quotas ([D16](cross-device-sync-design.md#decisions)) are the control. R2's free
  downloads keep large attachments from becoming an egress bill.
- **At 1,000 subscribers on $20 a year,** each one nets about $17 a year. The fixed lines stop mattering; payment
  fees and support time are what is left.

## What is not in the model

- **Your time.** Support, abuse, outages, and answering "I lost my recovery key" (end-to-end encryption makes that
  unrecoverable by design). At 100 paying users this is likely the real cost.
- **Income tax, a business entity, accounting, and a privacy policy and terms of service.**
- **Refunds and chargebacks,** and failed renewals.
- **Clerk's per-user pricing** past 50,000 retained users (irrelevant here).
- **Load.** Nothing has been measured; the smallest hosts here may not keep up at 1,000 subscribers (spike S6).
- **Whether people will pay.** Break-even is a count of subscribers, and getting them is a separate question.

## Apple's rules

- **The iPad app must offer the subscription as an in-app purchase** if it unlocks sync (Guideline 3.1.1). A subscription
  bought on the web may be used in the app only if it is also sold in the app (3.1.3(b)). So some revenue pays Apple's 15%
  whatever you prefer.
- **Linking out to your own checkout:** in the US storefront an app may include buttons and links to outside purchase without
  an entitlement. Whether Apple may charge a commission on those sales was still being decided in court in mid-2026
  ([MacRumors](https://macrumors.com/2026/06/11/apple-fights-back-against-epic/)), so do not plan on avoiding it. Elsewhere,
  steering users out needs an entitlement.
- Confirm all of this against the current guidelines before submitting.

## Reading it against the design

- **It supports a cheap start.** At 100 subscribers the comfort setup takes about a quarter of profit. Managed Postgres on
  Neon's free plan, or SQLite on one VM, costs about the same as each other at this size; the dearer failover tier is a
  choice about risk, not a need ([D3](cross-device-sync-design.md#decisions)).
- **Pricing suggestion:** lead with a yearly plan (about $20 to $36, so $27 is in range), and keep any monthly plan at $3 or more so fees stay
  near 14% to 22%. Start on Clerk Hobby and the lean setup, and revisit Pro and failover at around 30 subscribers.

## Sources

Prices read on 2026-11-05: [Obsidian](https://obsidian.md/pricing), [Bear Pro](https://bear.app/faq/features-and-price-of-bear-pro/)
and its [App Store listing](https://apps.apple.com/us/app/-/id1016366447), [Clerk](https://clerk.com/pricing),
[Stripe](https://stripe.com/pricing), [Paddle](https://www.paddle.com/pricing),
[Apple Small Business Program](https://developer.apple.com/app-store/small-business-program/),
[App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/),
[Fly.io](https://fly.io/pricing.md), [Cloudflare R2](https://developers.cloudflare.com/r2/pricing/),
[PlanetScale](https://planetscale.com/pricing), [Neon](https://neon.com/pricing).

**Unverified:** Bear's price comes from its App Store listing and a search summary, with trial length conflicting between
sources; Clerk Hobby's limits beyond those listed on its pricing page; Apple's rate for subscriptions after year one;
EU VAT treatment for a non-EU seller; and PlanetScale's storage price, which its page does not list (assumed included at
this size).
