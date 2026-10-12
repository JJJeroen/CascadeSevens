# Contributing to Cascade Break

Thanks for helping out. This page covers the workflow and the few repo rules
that make CI fail if you don't know them.

## Workflow

1. Create a branch from `main` (`feat/...`, `fix/...`, `chore/...`, `docs/...`).
2. Push it and open a pull request against `main`.
3. **Preview:** Cloudflare Pages builds every branch within a minute or so, at
   `https://<branch>.cascadesevens-pages.pages.dev/` (characters like `/` in
   the branch name become `-`). The PR shows a "Cloudflare Pages" check with the link.
4. Check the preview in a browser (phone width too).
5. Someone other than the PR author approves; `main` needs 1 approval and a
   green `test` check. Then it is merged, and `main` is published at
   `https://cascadesevens-pages.pages.dev/`.

## Repo rules CI enforces

The `test` check must pass before merging. Its rules:

- **`docs/` is the web root, and part of it is generated.** `docs/*.js` is
  compiled from `src/*.ts`. Change game logic or JavaScript in `src/*.ts`,
  run `npm run build`, and commit the regenerated `docs/*.js`. Never edit
  `docs/*.js` by hand: CI rebuilds it and fails if it differs from what you committed.
- **`docs/` holds only the shipped game.** CI fails on any extra or untracked
  file in `docs/`. Put notes, screenshots and mockups elsewhere (`images/`,
  `gui-design/`).
- **Formatting.** `npm run lint` runs ESLint, and Prettier on
  `src/**/*.ts`, `docs/**/*.{css,html}` and `tests/**/*.js`. Fix formatting
  with `npx prettier --write <file>`.
- **Tests.** `npm test` (rules and simulations) and `npm run test:browser`
  (headless Chrome). New behaviour should come with a test in `tests/`.

## Design / CSS-only changes

Editing `docs/*.css` or `docs/*.html` directly is fine, since those are not
generated. Run Prettier on them before pushing. If you touch `src/*.ts`, follow
the build step above.

## Running things locally

Needs Node 18 or newer (Node 22 for the browser tests) and Chrome/Chromium.

```
npm ci
npm run build       # compile src/ -> docs/
npm run lint
npm test
npm run test:browser
```

Open `docs/index.html` through a local web server to try the game
(`npx serve docs`, or any static server).

## Version number

The version shown in the game is `0.<number of the last merged PR>`. It is
written by `npm run build`, so you don't set it by hand.
