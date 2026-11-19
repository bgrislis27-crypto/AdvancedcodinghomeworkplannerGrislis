# Notes for agents

## Design direction

The owner really likes the current aesthetics and overall UI of both the planner and the showcase. Keep this look when making changes, and extend it rather than replacing it.

- **Notebook, not SaaS.** Paper backgrounds, navy ink, a yellow highlighter, and red pen accents. Notebook details include ruled lines, a red margin line, sticky notes, index cards, and the “Planner Facts” label.
- **Palette:** paper `#efe7d8`, cream `#fbf6ec`, ink `#11172a`, navy `#243f73`, marker `#ffd23f`, red `#d23f2a`. The planner app uses the same ink and paper tones.
- **Type:** Fraunces (big, heavy, tight letter spacing) for headlines, JetBrains Mono for labels and code, Caveat for handwritten notes. The planner itself uses a serif for headings and a sans-serif for numbers.
- **Motion:** bold and intentional. The showcase uses GSAP with ScrollTrigger and SplitText, plus Lenis for smooth scrolling, all vendored in `showcase/vendor/`. Pinned scenes, masked text reveals, and things that drop, stack, and sweep are all in keeping.
- **Copy:** short and plain. Avoid extra headings, footers, explanatory captions, and marketing phrases.
- **Avoid** the generic template look: purple gradients, icon tiles, glassy cards, sparkline decorations, and emoji.

## Data

Keep the localStorage keys `studyhub.assignments`, `studyhub.grades`, and `studyhub.prefs`, even though the app is now called UPlanner. Renaming them would wipe saved data.
