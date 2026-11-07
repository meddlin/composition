---
title: Preview showcase
description: Every component the preview draws
tags:
- demo
createdAt: 2026-11-06
updatedAt: 2026-11-06
---
<Toc maxDepth="2" />

# Preview showcase

Text with **bold**, *italic*, ~~gone~~, `code` and a [link](https://example.com). Staging resets <Mark color="green">every night</Mark>, so **back up <Mark color="yellow">first</Mark>**[^runbook].

<Info>

Staging resets **nightly**. See the [runbook](https://example.com).

- back up first
- then deploy

</Info>

<Warning>

This **deletes** every note in the group.

</Warning>

## Pictures

<Image src="app_data/demo-photo-0123456789ab.png" alt="A gradient" width="50%" />

<Drawio src="app_data/demo-diagram-0123456789ab.png" alt="Request flow" />

## Charts

<Chart type="line" x="month" y="sales,costs" title="2026">

```csv
month,sales,costs
Jan,10,7
Feb,12,8
Mar,9,9
Apr,14,10
```

</Chart>

<Chart type="pie" title="Share">

```csv
slice,share
A,40
B,35
C,25
```

</Chart>

## Links

<Repo url="https://github.com/meddlin/composition" description="The notes app" />

<YouTube url="https://youtu.be/dQw4w9WgXcQ?t=90" title="Demo of the release" />

<Repo url="not a repository" />

## Markdown

| a | b |
|:--|--:|
| 1 | 2 |

- [x] done
- [ ] todo

> quoted text

```swift
let x = 1
```

Cite[^runbook] and again[^cron].

[^runbook]: [Staging runbook](https://example.com/runbook), section 3.
[^cron]: See the _scheduler_ docs.

<Footnotes />
