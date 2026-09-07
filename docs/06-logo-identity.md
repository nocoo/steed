# Steed logo identity

## Direction

Replace the scattered rainbow portrait with a chestnut horse caught in a natural turn toward one small colorful bird. Broad connected flat facets describe the horse; the bird is the single multicolored accent. Preserve room around ears, eyes, and the visitor against the rounded-square presentation boundary. The lower neck and withers follow equine anatomy rather than a circular bust cut.

The selected generation and finishing history lives in the sibling `hexly.ai` repository under `artwork/logo-family/steed/2026-09-07-02/`. The first request remains archived in study `01`: its bird stayed inside the mane, so a second request corrected that relationship. This named five-project batch has owner-delegated raw-image acceptance; the agent inspects each exact image before extraction and records that the owner has not reviewed the returned bytes.

## Asset roles

| Consumer | Source | Treatment |
| --- | --- | --- |
| Canonical artwork | Root `logo.png` | Exact selected transparent master |
| README header | `assets/brand/icon-rounded.png` | Rounded presentation with independent teal field and canter-pleat relief |
| Expanded/collapsed sidebar | `apps/web/public/logo-24.png` | Transparent foreground; no added crop or color filter |
| Other small UI marks | `apps/web/public/logo-80.png` | Transparent foreground |
| Browser favicon | `apps/web/public/favicon.ico` | Transparent 16/32 px entries, generated from the full master |
| Apple touch icon | `apps/web/public/apple-touch-icon.png` | Square presentation; platform supplies its masking |
| Social preview | `apps/web/public/og-image.png` | Rounded presentation on the existing 1200 × 630 social canvas |

`scripts/resize-logos.py` generates the consumer sizes from the separately named foreground and presentation masters. `apps/web/index.html` declares the browser, touch, and social assets. The sidebar component in `apps/web/src/components/layout/sidebar.tsx` already uses an unmasked transparent image in both states.

## Atomic implementation plan

One source-adoption commit includes the selected masters, reproducible resize script, regenerated consumers, README image, metadata, and `assets/brand/README.md` with exact study/pass hashes. It also includes this design and the documentation index. No application-data or Worker-API change is required.

Before publication, verify exact master hashes, PNG alpha, every ICO entry, and real sidebar marks on both themes. Run the existing pre-commit G1/L1 and pre-push L2/G2 gates, then inspect CI and the automatic Release workflow. Hexly receives the exact source commit in its versioned original backup and the complete independent comparison page at `/logos/steed`.
