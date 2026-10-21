# HTML style for explainers and plans

Repository HTML documentation and plans use this style, starting from [template.html](template.html) in this folder. It's modeled on research posts that explain one idea clearly: Google Research's write-ups, Cursor's engineering posts, and Anthropic's research pages.

## The brief

Write the page the way a careful engineer explains a system to a colleague who will read it once, from top to bottom. Each section answers one question in plain prose and shows one picture of the mechanism. Put content first, and use style only where it helps the reader see something. It's a working document, not a launch page.

## Layout

- The page is wide, up to 1360px. A sticky table of contents on the left lists every section and marks the one you're reading. On narrow screens it sits above the article.
- Prose runs about 76 characters wide. Figures use the full width of the article column.
- The page opens with an eyebrow line, a title and a two- or three-sentence lede, with the subject, version and date underneath. There's no hero banner.

## Writing

- A heading names the topic or states the claim, in sentence case: "What the tree does for memory".
- Under each heading, write one to three short paragraphs: first what happens, then why.
- Use bullet lists for takeaways. Each bullet starts with an italic lead-in phrase, then says what it means: "*People appreciate the warning, even if they don't feel shaking.* 79% of people who…"
- Use numbered lists for anything done in order, each item with a bold lead-in.
- Put numbers inside sentences that say what they mean. Never show a number on its own.
- Define each term the first time it appears. If a reader couldn't draw what happens from the text, the text isn't done.
- Use examples from the user's own work: real ids, real questions, and what happens to each.
- Answer the user's questions in the prose, in the section where they come up, starting with the direct answer.

## Figures

- Each figure shows one mechanism. Put a title in the panel that states what it shows: "Decomposing work keeps every agent's context small".
- Draw what happens: boxes for things, arrows for what moves, and a label on every mark. Use a side-by-side when comparing two ways of doing something.
- In a box, put the human name first and the code identifier under it in small mono, like `addressRates.at()`.
- Group related boxes in a lightly tinted, labeled region, three groups at most.
- Color: dark lines and text on a quiet panel. Use one accent for the path or element to watch. Add up to three muted group tints only when the groups carry meaning.
- Put a caption under each figure, in italics, with one to three sentences on what to notice.
- For a chart of real numbers, title it with the question it answers ("Did you feel shaking?") and label the parts directly on the chart.

## Detail

Put full tables, call trees, function signatures and sources in collapsed drawers, placed right after the paragraph they support. A reader who skips every drawer should still understand the page.

## Appendix

End with an appendix of every word and concept the page used without explaining it, such as KNN, BM25, a hook or WAL. Each entry gets one or two sentences on what it means here, then a snippet that shows exactly how it works: the formula, the query, the command, or a tiny worked example with real values. On a wide screen the entries sit in two columns.

## Don't

- No big-number tiles or stat cards. A number without its sentence doesn't tell the reader anything.
- No card grids of slogans or questions. If the point is what happens, write what happens, or draw it.
- No hero banners, marketing buttons or taglines.
- No decoration: no gradients, tinted page grounds or colored section numbers.

## Type and color

- Use Inter for all text and IBM Plex Mono for code. Body text is 17px with 1.65 line height. Headings are weight 600: about 46px for the title, 28px for sections and 20px for subsections. Never use a serif.
- Light theme: a white page, near-black text (#111) and dark gray secondary text (#454545).
- Dark theme: a near-black page (#141414), light text (#f2f2f2) and light gray secondary text (#cfcfcf).
- Both themes need high contrast. Check both, and keep the light/dark toggle at the foot of the table of contents.
- The accent is blue (#2563eb in light, #6ea8fe in dark). The group tints are green, blue and rose, defined as tokens in the template.

## Build

1. Copy `template.html` and keep its tokens, layout and script. Delete any component the page doesn't use.
2. Draw figures as inline SVG using the template's `d-*` classes. Use figures when they clarify a mechanism; omit unused components. The page loads no libraries; Google Fonts is its only external resource.
3. Save maintained documentation to `docs/<kebab-name>.html` and design plans to `docs/plans/<kebab-name>.html`. Save temporary explorations to the git-ignored `artifacts/` directory.
4. Render it once in each theme and fix what the renders show. Check local links and scripts, and link maintained documentation from the README or another relevant document. Publish only when requested.
5. Copy rules: plain words, no em dashes, and the user-facing name first with the code name in `code` beside it. Every number carries its source or the date it was measured.
