# Benchmarks lookup illustration QA

final result: passed

## Visual target and evidence

- Selected visual: `/tmp/paseo-attachments-b43HJt/4239acc81c5733286590f8ddefdb745c7a80c85b550ab459f7eba88b704d4976.png` (2340 × 1594). The attached selection takes precedence over the option number.
- Implementation: `/benchmarks`, captured in local headless Chrome through the Chrome DevTools Protocol because no in-app browser tool is available.
- Desktop: 1440 × 1024 CSS pixels, device scale factor 1; dark and light themes.
- Mobile: 390 × 844 CSS viewport, device scale factor 1; 390 × 1800 extended dark-theme capture.
- Screenshots: `../artifacts/benchmark-design/desktop-dark.png`, `desktop-light.png`, and `mobile-dark.png`.
- Full-view comparison: `../artifacts/benchmark-design/comparison.png`.
- Focused illustration comparison: `../artifacts/benchmark-design/hero-comparison.png`.
- Source content and browser content were cropped to their corresponding regions and proportionally normalized to 936 pixels wide in the combined comparisons. The reference is an image, so its CSS viewport and original pixel density are unknown. No density-based pixel-perfect claim is made.

## Findings

No actionable P0/P1/P2 findings remain for this addition.

- Typography: existing Inter typography, page heading, table sizes, and readable labels are preserved. Illustration captions are real text; the example rate remains printed inside the receipt asset.
- Layout: the three scenes and blue connectors follow the selected design. The cost bracket sits under the center scene. Existing navigation and the site's 1000-pixel content container remain intact. Mobile deliberately stacks the scenes and places the cost callout immediately after the lookup stage.
- Colors: existing background, text, muted text, and amber tokens adapt to light and dark themes. Transparent white/gray/blue illustrations render on both backgrounds.
- Images: actual generated raster assets reproduce the selected house/envelope, neighborhood/pin/calculator, and 8.00% receipt. No CSS/SVG approximations replace those assets. Lossless WebP conversion preserves the generated pixels and transparency.
- Copy: address, process caption, output label, cost question, and supporting sentence match the selected graphic. Existing benchmark figures and pricing content remain managed by the existing page/components.

## Behavior and verification

- All five displayed illustration images loaded successfully in every tested viewport/theme.
- The cost link navigates to `#pricing` and brings Pricing into view.
- The pricing methodology disclosure opens successfully.
- No browser runtime exceptions or error log entries were recorded.
- The mobile document width is 390 pixels at a 390-pixel viewport. The pre-existing accuracy table uses its own horizontal scrolling container.
- `pnpm check`: zero errors and zero warnings.
- `pnpm build`: passed, including prerendering and static asset resolution. Existing MapLibre bundle/import warnings remain outside this change.
- `git diff --check`: passed.

## Comparison history

The first valid normalized comparison found no actionable P0/P1/P2 differences in the requested addition. The navigation, existing typography, current benchmark data, and narrower established page container are intentional integration constraints rather than attempts to recreate the entire screenshot as an image.

## Follow-up polish

- P3: independently generated scenes have small differences in receipt angle and house proportions from the mockup; their palette, pixel scale, subjects, and reading order match the chosen direction.

## Implementation checklist

- [x] Generate and inspect the three transparent scenes and connector asset.
- [x] Insert the responsive illustration above Accuracy.
- [x] Link the cost question to Pricing.
- [x] Check desktop dark/light and mobile rendering, image loads, console errors, and the pricing interaction.
- [x] Inspect full-view and focused combined comparisons.
- [x] Pass Svelte checking and the production build.
