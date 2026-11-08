# Cross-device sync: production chores

What it takes to run the hosted sync service for outside users, apart from the servers themselves: payments, abuse, customer
requests, security, vendor upkeep and paperwork. It is written to be studied, so that each chore can become a runbook or an
automation where that pays off. It belongs with [the design](cross-device-sync-design.md) and
[the price and cost report](cross-device-sync-pricing.md), whose "what is not in the model" list this expands.

**This is a checklist of chores, not a set of runbooks.** Nothing is built. Counts and hours are my guesses, to be replaced by
real numbers once there are customers. I am not a lawyer or an accountant: every legal, tax and store-policy item below says
"confirm" because it needs checking against the current rules before launch. Dates are 2026-11-05.

## How to read this page

Each chore has an id so that runbooks and automations can refer to it.

| Prefix | Area |
|---|---|
| PAY | Payments and billing |
| ABU | Abuse and trust |
| REQ | Customer requests |
| OPS | Operations and reliability |
| SEC | Security |
| LEG | Legal, finance and business admin |
| LIF | Product lifecycle and communication |

**Automate** column: **A** means it can be fully automated; **P** means automate the detection and the preparation but you
decide; **M** means it stays manual.

## The shape of the work

| Area | What it is | Mostly | Biggest risk if neglected |
|---|---|---|---|
| Payments | Three payment routes to keep in step with who is allowed to sync | A and P | Paying users locked out, or lapsed users syncing for free |
| Abuse | Fake accounts, storage abuse, legal requests. There is no sharing or public link in the product, and notes are encrypted, so content abuse is mostly out of reach by design | A | A surprise storage bill, or a legal request handled badly |
| Customer requests | Lost passphrases, "my notes are missing", deletion and export, billing questions | P | The largest share of your time |
| Operations | Alerts, backups, deploys, patches, key expiry, vendor changes | A | Backups you cannot restore |
| Security | Reports, advisories, breach response, your own account hygiene | M | One person is a single point of failure |
| Legal and finance | Policies, vendor agreements, tax, bookkeeping | M | Exposure that only shows up later |

## Decide before launch

These are policies, not chores, but each one becomes chores later. Writing them down first makes the runbooks short.

| Policy | Options to choose between | Why it matters |
|---|---|---|
| What happens when a subscription lapses | Sync pauses at once, or after a grace period; local data always stays | Drives PAY-2 and every "why did sync stop" request |
| How long data is kept after a lapse or a deletion | For example 30, 60 or 90 days, then deleted | Storage cost, privacy promises, and what you tell people (backups also age out) |
| Refund policy | A window (for example 14 or 30 days); case by case beyond it | PAY-5; Apple users are refunded through Apple, so the policy differs by channel (confirm) |
| Free trial | Length, whether a card is required, one per person | Trial abuse (PAY-10) and conversion |
| Quotas and what happens past them | Storage and record limits; block new uploads, or warn and ask | ABU-2; D16 in the design |
| Lost-key policy | The server copy cannot be recovered. Say so plainly at sign-up | REQ-1; the real product cost of end-to-end encryption |
| Support | Channel, hours, target reply time, best effort or promised | REQ-*; sets expectations for a one-person service |
| Abuse and termination | A ladder: warn, suspend, terminate; what you will not do | ABU-7 |
| Legal requests | What you hold (ciphertext, account data, timestamps, perhaps IPs), and who answers | ABU-5 and ABU-6 |
| Logging and retention | What is logged, for how long; never content, keys or tokens | ABU-10, and the privacy policy |
| Old app versions | How old a version may be before sync refuses it | OPS-11, LIF-3 |
| Price changes | Whether existing subscribers keep their price | PAY-9 |

## Payments and billing

Where the money is taken decides who does the work. Three routes are in the pricing report: Apple in-app purchase (required in
the iPad app if it unlocks sync), Paddle as a merchant of record, and Stripe.

| Chore | Apple in-app purchase | Paddle (merchant of record) | Stripe |
|---|---|---|---|
| Charging and renewals | Apple | Paddle | Stripe, with Stripe Billing for subscriptions |
| Sales tax and VAT | Apple collects and remits in most regions (confirm per region) | Paddle collects and files, per its pricing page | You register and file; Stripe Tax calculates where you are registered |
| Refunds | Apple decides; you are notified (confirm) | Your policy, issued through Paddle | You issue them |
| Chargebacks | Apple | Paddle's page lists chargebacks and buyer support as covered | You answer each dispute with evidence, inside the card network's deadline |
| Failed-payment retries | Apple | Paddle | Stripe Billing settings; you tune the emails |
| Receipts and invoices | Apple | Paddle | Stripe, or you |
| Payouts | Apple, on its schedule | Paddle | Stripe, to your bank |
| How our server learns who has paid | App Store Server Notifications | Webhooks | Webhooks |

| Id | Chore | When | The work | Automate | If missed |
|---|---|---|---|---|---|
| PAY-1 | Entitlement sync | Every purchase, renewal, cancellation and refund | Receive Apple notifications and Paddle or Stripe webhooks, verify their signatures, update the account's entitlement, handle repeats safely, replay missed events | A | Paying users locked out, or lapsed users keep syncing |
| PAY-2 | Lapse lifecycle | When a subscription ends | Grace period, then paused sync (local data untouched), then the retention clock, warnings, deletion | A | Surprise deletions, or data kept forever |
| PAY-3 | Reconciliation | Monthly | Compare each provider's subscriber and revenue reports with the entitlement table and list mismatches | A to find, P to fix | Silent revenue leaks or free riders |
| PAY-4 | Failed renewals | Each failed charge | Let the provider retry; choose the grace length; make sure the "fix your card" email goes out | A and P | Involuntary churn |
| PAY-5 | Refund requests | A few a month | Check the policy and the channel; Apple users ask Apple; issue through Paddle or Stripe; adjust the entitlement | P | Unhappy customers, or refunds you cannot match to an account |
| PAY-6 | Chargebacks | Rare | Respond with evidence before the deadline (Stripe), or let Paddle handle it; record the outcome | P | Lost disputes and processor penalties |
| PAY-7 | Tax | Each filing period | With Stripe: register, collect and file sales tax and VAT. With Paddle or Apple: confirm they cover each region you sell in | M | Legal exposure |
| PAY-8 | Bookkeeping and payouts | Monthly | Match payouts to the bank, record fees and costs, keep records for the tax return | P | A messy year-end |
| PAY-9 | Price and plan changes | Rare | Change prices in every provider, decide on grandfathering, tell subscribers, update the app | M | One channel left on the old price |
| PAY-10 | Fraud and promo abuse | Occasional | Stolen cards, refund abuse, repeated trials: flag, block, keep a note | P | Chargebacks and wasted storage |
| PAY-11 | Apple admin | Ongoing, and yearly | Keep the Developer Program ($99 a year), agreements, banking and tax forms current; keep the Small Business Program enrolment valid (confirm the yearly check) | M, with reminders | Apps pulled or payouts held |
| PAY-12 | Cost watch | Weekly | Compare the vendor bills (host, database, R2, Clerk) with revenue; set budget alerts | A | A runaway bill, such as a bandwidth spike |

## Abuse and trust

Two design facts shape this area. The product has **no sharing and no public links** (both are non-goals), so there is no way
to publish content to other people. And notes are **end-to-end encrypted**, so the service holds ciphertext it cannot read or
scan. That removes most content-abuse work and leaves storage, account and payment abuse, plus legal requests that arrive
anyway.

| Id | Chore | When | The work | Automate | If missed |
|---|---|---|---|---|---|
| ABU-1 | Bot and fake signups | Continuous | Use whatever bot protection Clerk offers on your plan (check what it includes); rate-limit sign-up and sign-in; require email verification | A | Junk accounts and email reputation damage |
| ABU-2 | Storage and quota abuse | Continuous | Enforce quotas (D16) and a record-size cap; alert on outliers; look at the top users each month | A to detect, P to act | A storage bill from a few accounts |
| ABU-3 | API abuse and credential stuffing | Continuous | Per-device and per-IP rate limits, back-off and lockouts, alerts on spikes | A | An outage or an account takeover |
| ABU-4 | Account sharing and resale | Occasional | A device-count limit, an unusual-use report, a policy line in the terms | P | Revenue leakage |
| ABU-5 | Reports of illegal content | Rare | You hold ciphertext only and cannot view it. Acknowledge, explain, and follow legal advice on preservation | M | Legal exposure |
| ABU-6 | Legal requests (subpoenas, court orders, takedown notices) | Rare | Know what exists (ciphertext, account data, timestamps, IPs if logged), decide log retention in advance, and answer through a lawyer | M | Over- or under-disclosure |
| ABU-7 | Enforcement | Rare | Warn, suspend, terminate, as the terms say; keep an audit log | M | Inconsistent decisions |
| ABU-8 | Our own email reputation | Ongoing | SPF, DKIM and DMARC on the sending domain; watch bounces and complaints for the mail you send yourself | P | Mail lands in spam |
| ABU-9 | Attacks on the service | Rare | Rely on the host's and CDN's protections; know how to tighten rate limits; post status updates | M | An outage |
| ABU-10 | Log hygiene | Continuous | Never log content, keys or tokens; set an IP retention period; review logs now and then | A | A privacy breach |

## Customer requests

The support rule that follows from the design: **you can see account metadata and errors, never note content.** Tooling has to
make that the easy path.

| Id | Request | What to do | Automate |
|---|---|---|---|
| REQ-1 | Forgot the passphrase and lost the recovery key | Say plainly that the server copy cannot be recovered. If any device is still unlocked, use "reset encryption" to set a new passphrase and re-upload from it. Otherwise start a fresh vault; the data on devices is untouched | P (canned reply and an in-app flow) |
| REQ-2 | "My notes are missing" or "it is not syncing" | Ask for the diagnostics bundle; check last sync, cursor, `epoch` and error codes; try a forced resync; check the Trash (60 days) | P (diagnostics screen and self-serve resync) |
| REQ-3 | "A conflict copy appeared" | Explain the keep-both rule and link to the help page | A (help page) |
| REQ-4 | Cannot sign in | Check Clerk (email delivery, method); revoke stuck sessions; resend | P |
| REQ-5 | Change of email, or two accounts to merge | Do it in Clerk after verifying identity | M |
| REQ-6 | Lost or stolen device | Self-serve device list and revoke; suggest a new passphrase if worried | A |
| REQ-7 | Delete my account | In-app deletion (the App Store requires it; confirm): delete records, blobs and the Clerk user; say how to cancel a subscription held by Apple or Paddle; explain that backups age out | A (a pipeline with an audit entry) |
| REQ-8 | Export my data | The app exports plain text; the server copy is ciphertext and useless alone. Explain this | A |
| REQ-9 | Privacy-law requests (access, correction, erasure) | Verify identity and answer inside the legal deadline (GDPR: one month; confirm); keep a record | P |
| REQ-10 | Billing question | Look up the plan and provider in the console; point to the provider's receipt or refund route | P (console and canned replies) |
| REQ-11 | Refund request | See PAY-5 | P |
| REQ-12 | Storage full, or a quota increase | Show usage; explain the quota; offer cleanup guidance or a case-by-case raise | P |
| REQ-13 | "This app version can no longer sync" | The app shows an upgrade message driven by `GET /v1/info`; point to the update | A |
| REQ-14 | Bug report | Reproduce from the diagnostics bundle; file an issue | M |
| REQ-15 | Feature request | Log it and send a standard reply | M |
| REQ-16 | Self-hosted questions | Answer under a separate, narrower policy (see below) | M |

**Support tooling worth having**

- A shared inbox with a library of canned replies, one per request above.
- A **support console**: read-only account view (plan, provider, devices, storage, last sync, error counts), never content,
  with an audit log of every action.
- An in-app **diagnostics bundle** a user can send: versions, cursor, `epoch`, last error, no content.
- A help centre covering conflicts, the passphrase and recovery key, deletion and export.
- A status page.

## Operations and reliability

The metrics themselves are in [Observability](cross-device-sync-design.md#observability); this is the work around them.

| Id | Chore | When | The work | Automate | If missed |
|---|---|---|---|---|---|
| OPS-1 | Monitoring and alerts | Continuous | Propagation latency, conflict rate, error rates, SSE connections, database size, replication lag (lean setup), the bill. Decide what is worth waking up for | A | Silent failure |
| OPS-2 | Backups and restore drills | Quarterly | Restore the latest backup to a scratch environment, run the checks, time it. The steps differ for lean, Postgres and Convex | A and P | Backups you cannot restore |
| OPS-3 | Deploys, migrations, rollbacks | Each release | CI deploy, run migrations, keep the previous version ready, bump the protocol version when needed, update the changelog | A | A bad deploy |
| OPS-4 | Patching | Monthly | OS, runtime and dependency updates (the lean VM especially); act on advisories | P | Known vulnerabilities |
| OPS-5 | Secrets and expiry | On a calendar | Rotate R2, Clerk, webhook and Apple keys; renew the domain; renew code-signing certificates | A (reminders) | A sudden outage |
| OPS-6 | Data hygiene jobs | Daily | Delete expired retry records and sessions; compact tombstones (90 days); collect orphaned blobs; recount quotas | A | Bloat and wrong quotas |
| OPS-7 | Capacity review | Monthly | Storage and database growth, plan limits, vendor tier changes | P | Surprise limits or bills |
| OPS-8 | Incident response | When it happens | Detect, triage, tell users (status page, email), fix, write a short postmortem | P | Longer outages and lost trust |
| OPS-9 | Vendor changes and outages | Ongoing | Follow status and pricing notices for Clerk, the host, the database, R2, Paddle; review each vendor yearly | P | A surprise price or terms change |
| OPS-10 | Server restore events | Rare | Issue a new `epoch`, check that devices resync, tell users if data was lost | P | Devices that disagree |
| OPS-11 | App releases | Each release | Build, sign, notarize, store review, update channels; keep the protocol compatible with older apps | P | Users stuck on old versions |
| OPS-12 | Cost per account | Monthly | Storage and calls per account; look at the top users and the unprofitable tail | A | A hidden loss on heavy users |

## Security

| Id | Chore | When | The work | Automate |
|---|---|---|---|---|
| SEC-1 | Vulnerability reports | Rare | Publish a contact (a `security.txt`), triage within days, fix, credit | M |
| SEC-2 | Dependency advisories | Continuous | The repo already has Dependabot and a recent advisory patch; extend the same to the server | A |
| SEC-3 | Breach response | Rare | Contain, assess (with end-to-end encryption, ciphertext plus account data is exposed), and notify users and regulators where required (GDPR: 72 hours to the regulator after becoming aware; confirm) | M |
| SEC-4 | Your own accounts | One-off, then yearly | Hardware keys or two-factor on every vendor dashboard, a password manager, least-privilege tokens, a recovery plan for each account | M |
| SEC-5 | One person is the single point of failure | One-off | A written emergency document: where credentials live and who can act if you cannot; consider a trusted second person with limited access | M |
| SEC-6 | Pre-launch review | One-off | An independent look at the encryption design (S5), the sign-in broker and the rate limits, plus a threat-model pass | M |
| SEC-7 | Code and build integrity | Each release | Sign builds, protect CI secrets, keep GitHub Actions pinned to commit SHAs (a repo rule already) | A |

## Legal, finance and business admin

| Id | Chore | When | The work | Automate |
|---|---|---|---|---|
| LEG-1 | Privacy policy and terms of service | One-off, then yearly | Draft with a lawyer or a reputable template; describe end-to-end encryption honestly; include the refund, lapse and retention rules | M |
| LEG-2 | Subprocessors and data agreements | One-off, and on change | List the vendors (Clerk, host, database, R2, payments, email); sign data-processing terms where needed; publish the list | M |
| LEG-3 | Where data lives | One-off | Which regions hold data, and whether EU users need EU storage | M |
| LEG-4 | Business entity, bank account, insurance | One-off | Decide with an accountant; keep business money separate | M |
| LEG-5 | Tax registrations | One-off, then yearly | Depends on the payment route (PAY-7) | M |
| LEG-6 | Store agreements and guidelines | Yearly | Re-read Apple's agreements and review guidelines (in-app deletion, in-app purchase rules); the design already says to confirm them | M |

## Product lifecycle and communication

| Id | Chore | When | The work | Automate |
|---|---|---|---|---|
| LIF-1 | Onboarding and lifecycle emails | Continuous | Welcome, trial ending, payment failed, subscription ending; mostly sent by the payment provider | A |
| LIF-2 | Changelog and release notes | Each release | A short public changelog | P |
| LIF-3 | Deprecation notices | Per policy | Warn well ahead before a protocol version stops syncing | P |
| LIF-4 | Churn and cancellation reasons | Monthly | Ask why, count it, look for patterns | A |
| LIF-5 | Trial conversion | Monthly | Watch the rate; adjust the trial | M |
| LIF-6 | Status updates | During incidents | Post to the status page (OPS-8) | P |

## The self-hosted server: what differs

The self-hosted server (D20, the lean setup) is a separate product, so most of this page does not apply to it. What does:

- **A narrow support policy** (REQ-16): what you will answer, and that self-hosters back up their own volume.
- **Security advisories** (SEC-1, SEC-2) and a clear upgrade guide, with a compatibility table of server and app versions.
- **No payments, no Clerk, no accounts you host.** There is no entitlement to sync (PAY-*), and no data of theirs on your systems.
- **Protocol versions** (LIF-3) matter more, because self-hosters upgrade on their own schedule.

## What to automate first

Ranked by how much each saves and how bad it is if it is missing at launch.

| # | Automation | Covers | When |
|---|---|---|---|
| 1 | Entitlement webhooks and a reconciliation job | PAY-1, PAY-3 | Before launch |
| 2 | The lapse lifecycle job | PAY-2, PAY-4 | Before launch |
| 3 | Account deletion and export pipeline | REQ-7, REQ-8 | Before launch (the App Store requires in-app deletion; confirm) |
| 4 | Support console (read-only, audited) and the diagnostics bundle | REQ-2, REQ-4, REQ-10 | Before launch, a basic version |
| 5 | Alerts and budget alarms | OPS-1, PAY-12, ABU-2, ABU-3 | Before launch |
| 6 | Scheduled hygiene jobs | OPS-6 | Before launch; they are part of the server |
| 7 | An expiry calendar for keys, certificates and domains | OPS-5, PAY-11 | Before launch; it is cheap |
| 8 | Canned replies and help pages | REQ-1 to REQ-16 | Before launch; it is cheap |
| 9 | A restore-drill script | OPS-2 | Soon after launch |
| 10 | Abuse detectors (signups per IP, storage outliers, failed sign-ins) | ABU-1 to ABU-4 | Soon after launch |
| 11 | A weekly operator report: revenue, new and churned subscribers, support volume, incidents, costs | OPS-12, LIF-4 | Soon after launch |
| 12 | Status-page automation | OPS-8, LIF-6 | Later |

## Runbooks to write

One page each, using the same template.

| Runbook | Trigger | Chores it covers |
|---|---|---|
| R-01 Service down | An alert, or a user report | OPS-1, OPS-8 |
| R-02 Restore from backup | Data loss or a failed host | OPS-2, OPS-10 |
| R-03 Entitlement mismatch | A paying user is blocked, or a lapsed user is not | PAY-1, PAY-3 |
| R-04 Refund | A refund request | PAY-5 |
| R-05 Chargeback | A dispute notice | PAY-6 |
| R-06 Account deletion | A deletion request or in-app deletion | REQ-7 |
| R-07 Data export | An export request | REQ-8, REQ-9 |
| R-08 Lost passphrase | A "cannot unlock" message | REQ-1 |
| R-09 Legal request | A subpoena, court order or takedown notice | ABU-5, ABU-6 |
| R-10 Security incident | A vulnerability report or suspected breach | SEC-1, SEC-3 |
| R-11 Vendor outage | A vendor status alert | OPS-9 |
| R-12 Deploy and roll back | A release | OPS-3 |
| R-13 Rotate secrets | An expiry reminder or a leak | OPS-5 |
| R-14 Abuse report | An abuse alert or complaint | ABU-1 to ABU-4, ABU-7 |
| R-15 Price change | A decision to change prices | PAY-9 |
| R-16 App release | A new app version | OPS-11 |

**Template.** Id and title; trigger; who and when (severity); what you can and cannot see; steps; how to confirm it worked; what
to tell the user; what to record; rollback or escalation; what to automate next.

## How big is it? (a guess)

Planning guesses at 100 subscribers, to be replaced by counts. **Count each of these from the first day.**

| Per month | Guess |
|---|---|
| Support contacts | 5 to 10 |
| Refund requests | 1 to 3 |
| Failed renewals | A few; fewer with yearly billing |
| Chargebacks | 0 to 1 |
| Account deletions | 1 to 3 |
| Lost-passphrase cases | 0 to 2 |
| Abuse or legal reports | 0 to 1 |
| Incidents | 0 to 2 |
| Vendor notices needing action | 2 to 5 |

| Area | Hours a month (guess) |
|---|---|
| Payments and billing | 2 to 4 |
| Customer requests | 4 to 10 |
| Operations | 3 to 6, plus incidents |
| Security, legal and admin | 2 to 4 |
| **Total** | **About 10 to 25** |

**Why it matters for pricing.** On the lean setup at $20 a year and 100 subscribers, profit after costs is about $1,640 a year
([pricing report](cross-device-sync-pricing.md)). Ten to twenty-five hours a month is 120 to 300 hours a year, which comes to
roughly $5 to $14 an hour. At that size the chores are the real cost, and automating the top of the list above is what changes
it.

## Sources

[Paddle pricing](https://www.paddle.com/pricing) (its page lists tax, chargebacks and buyer support as covered),
[Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), and the design and pricing reports in
this folder. Everything legal, tax or store-policy here needs confirming against current rules.
