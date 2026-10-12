# Cascade Break

Before changing anything, read `CONTRIBUTING.md` in this repo and follow it.

Short version of the rules that make CI fail:

- `docs/*.js` is generated from `src/*.ts` by `npm run build`. Edit `src/*.ts`, rebuild, commit the output. Never hand-edit `docs/*.js`.
- `docs/` must contain only the shipped game (no notes, screenshots or other extra files).
- Run `npm run lint` before pushing (Prettier covers `docs/**/*.{css,html}`).
- Work on a branch and open a PR against `main`; do not push to `main`.
