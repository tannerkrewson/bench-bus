# Collectors

Artificial Analysis collection computes the deterministic AA-listed Pareto
frontier from each model's canonical Intelligence Index workload, using the
shared 90% cache-hit default (`collectors/aa/frontier.ts`). The OpenRouter
collector can receive the latest AA snapshot via `--frontier-aa`; frontier
identities are admitted to lookup before unmatched models are reported.
Automatic frontier matching accepts unique punctuation-normalized model names
(such as AA's `claude-fable-5-1` and OpenRouter's `claude-fable-5.1`) and maps
known reasoning-effort variants to their shared base identity. Ambiguous matches
remain reported rather than guessed.

Operator-forced models are declared in
`collectors/openrouter/curated-models.json` and passed through
`--curated-config`. They are independent of automatic frontier selection. The
first example is DeepSeek V4 0731 Flash (`deepseek-v4-flash` mapped to
`deepseek/deepseek-v4-flash-0731`). A forced model is looked up when its stable
OpenRouter id is present in the catalog; missing catalog matches remain a
reported missing match and do not fabricate pricing.
