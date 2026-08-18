# Architecture and Product Decisions

This file records additions/changes after the bootstrap project pack. Baseline decisions remain in force unless overridden here explicitly.

## D-013 — Frontend deployment baseline

**Decision:** Preserve the current Netlify-oriented Hugo deployment path for V1 unless production inspection reveals a concrete blocker.

**Reason:** GitHub Pages is disabled on the active repository while `netlify.toml` defines the Hugo build/publish path.

## D-014 — Sunset page integration pattern

**Decision:** Implement `/sunset/` as a dedicated Hugo content type/template with namespaced assets and a cinematic sub-identity.

**Reason:** This matches the existing custom `performance` layout pattern and avoids unrelated-site refactoring.

## D-015 — Hugo configuration normalization prerequisite

**Decision:** Before STEP 5 frontend implementation, consolidate the conflicting Hugo root configuration and pin one validated production Hugo version.

## D-016 — Mutable project-control source of truth

**Decision:** From STEP 1 onward, use `Okgpb/okgpb-web/docs/sunset-signal/` as the mutable cross-repository project-control ledger.

**Reason:** ChatGPT Project uploaded files are not reliably replaceable in-place by the implementation workflow. GitHub is directly readable/writable by the connected development tooling and provides version history.

**Implication:** Uploaded Markdown files remain the bootstrap specification snapshot. `CURRENT_STATUS.md`, `DECISIONS.md`, and subsequent step assessments in GitHub are updated as implementation progresses.

## D-017 — Backend repository remains separate

**Decision:** Backend code is maintained in `Okgpb/sunset-service`, not inside the Hugo frontend repository.

**Reason:** Worker runtime, D1 migrations, secrets, scheduling, webhook handling, and backend tests have a different deployment lifecycle from the static site.

## D-018 — STEP 1 Worker configuration format

**Decision:** Use `wrangler.jsonc` rather than TOML for the new Worker.

**Reason:** Current Cloudflare tooling recommends JSON configuration and it keeps the baseline aligned with modern Wrangler configuration/schema generation.

## D-019 — No fake STEP 1 closure

**Decision:** Local TypeScript and SQLite validation are necessary but not sufficient to mark STEP 1 PASS.

**Reason:** The Master Plan exit gate explicitly requires a deployable Worker and a clean D1 migration. Real Wrangler/D1 execution must be completed once GitHub and Cloudflare infrastructure are available.
