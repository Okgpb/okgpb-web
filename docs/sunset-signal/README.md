# Sunset Signal — Project Control

This directory is the mutable project-control source of truth for Sunset Signal after project bootstrap.

## Source-of-truth policy

The Markdown files originally uploaded into the ChatGPT Project are the **bootstrap specification snapshot**. ChatGPT cannot replace those uploaded project files in-place reliably, so they must not be used as the only mutable status store.

From STEP 1 onward:

1. Product requirements, UI/motion contracts, security rules, API contracts, and other baseline specifications remain authoritative unless a recorded decision changes them.
2. Mutable execution state is maintained in this GitHub directory, especially `CURRENT_STATUS.md`, `DECISIONS.md`, and step assessments.
3. Every completed implementation step must update the GitHub control docs in the same work cycle as the code change.
4. If a baseline specification must change, record the rationale in `DECISIONS.md` before treating the new interpretation as authoritative.
5. Backend code lives in the separate `Okgpb/sunset-service` repository; this control directory remains the cross-repository project ledger unless deliberately migrated later.

## Repository map

- Frontend: `Okgpb/okgpb-web`
- Backend: `Okgpb/sunset-service` (separate repository; creation pending at STEP 1 infrastructure gate)
- Mutable project control: `Okgpb/okgpb-web/docs/sunset-signal/`

## Current phase

See `CURRENT_STATUS.md`.
