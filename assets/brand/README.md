# Steed brand assets

A chestnut horse turns toward a single colorful bird perched at the outer mane boundary. The bird extends into negative space while a natural equine neck and withers enter from the lower right.

## Use by surface

| Surface | Asset | Treatment |
| --- | --- | --- |
| README header / large gallery | `assets/brand/icon-rounded.png` | Selected rounded presentation, shown at 128 px in README |
| Sidebar in both states | `apps/web/public/logo-24.png` | Transparent 24 px foreground; no mask or color filter. |
| Other small UI marks | `apps/web/public/logo-80.png` | Transparent foreground. |
| Browser | `apps/web/public/favicon.ico` | Complete transparent 16/32 px ICO, generated from the full master. |
| Apple touch | `apps/web/public/apple-touch-icon.png` | Opaque 180 px square presentation. |
| Social | `apps/web/public/og-image.png` | Rounded presentation on the 1200 × 630 dark canvas; declared in `apps/web/index.html`. |

Root `logo.png` is the canonical 2048 × 2048 transparent foreground. `assets/brand/icon.png` and `icon-rounded.png` are separate square and rounded presentation masters. Small application and browser marks use the transparent foreground without a baked-in background, glow, color filter, or extra circular mask. Larger README, native-install, and social surfaces may use the designed background according to their platform contract.

## Rebuild and provenance

```sh
uv run --with pillow python scripts/resize-logos.py
```

Two native requests; study 01 is rejected history and study 02 is selected. Azure Foundry `gpt-image-2`, native 2048 × 2048; selected study `2026-09-07-02`, finishing `01`. The owner delegated intermediate acceptance for this named five-project batch. The recorded agent inspection is not a claim that the owner reviewed the returned image bytes.

The smallest protected-feature clearance is **214.5 px** against the actual 23% rounded outline. Intentional lower neck/shoulder intersections are recorded separately; no expressive feature or accessory is clipped. The selected extraction preserves every fully opaque native RGB pixel. All artwork, background, grain, and shadow layers remain separate in the Hexly study.

The presentation uses **Canter pleats**, with base `#53817c`, light `#a4bdb0`, shade `#305651`, and motif `#1e403c`. Product UI colors remain independent. [source.json](source.json) records exact master hashes and the prior source identity.

- [Individual before/after page](https://hexly.ai/logos/steed)
- [Complete generation and finishing archive](https://github.com/nocoo/hexly.ai/tree/main/artwork/logo-family/steed/2026-09-07-02)
- [Local static review](https://index.dev.hexly.ai/artwork/logo-family/steed/2026-09-07-02/review.html)
- [Shared usage SOP](https://github.com/nocoo/hexly.ai/blob/main/docs/07-logo-usage-sop.md)
