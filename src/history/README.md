# Historical time travel

Shared point-in-time state for browsing previously collected benchmark data.

- `types.ts` — bundle-index, freshness, and selection state types.
- `resolve.ts` — pure resolution: selection → effective compiled entry
  (newest at or before the selection; `null` selection = latest), per-source
  freshness from a decoded bundle, and staleness wording.
- `urlState.ts` — `history.t` URL (de)serialization (forgiving, like the
  chart URL state).
- `timeTravel.ts` + `TimeTravelContext.tsx` — provider/hook holding the
  shared selection (`useTimeTravel`).
- `src/controls/TimeTravelControl.tsx` — the selector UI (latest + compiled
  times + return-to-latest + pre-history notice).
- `src/controls/FreshnessChips.tsx` — per-source freshness display
  ("OpenRouter pricing as of … · last sampled 5h ago"; missing sources say
  "no data at this time").

History begins at the first collected snapshot: times before it resolve to
pre-history with no data, never to fabricated content.
