# Verification update — 8 November 2026

The verification flow has been changed and the authorized **six Gemini calls are complete**. The museum's three-part question was answered correctly and the unsupported monkey question was rejected. Testing also exposed two application safeguards that have now been strengthened and verified by replaying the actual recorded responses without network calls. **The current 1.7B Ollama model remains unreliable for semantic review**, and these checks are not a claim of universal model accuracy.

## Implementation

- Factual answers use an independent structured review of support and relevance instead of the former Laya score veto. The reviewer receives the full visitor question, individual requests, and the actual cited source pages.
- A draft quotation can be corrected once within that review. Every selected quote must match its cited, tenant-scoped source page before it can be returned. Invalid IDs, fabricated quotes, and unsupported numbers cannot authorize a paraphrase.
- A real quote still needs a relevance judgment. Exact text matching proves provenance, not semantic correctness. That judgment remains dependent on the configured language model.
- Numeric values stay coupled to their explicit units and currencies. A reviewer saying “supported” cannot authorize changing 90 minutes into 90 hours. Such a numeric mismatch uses the actual source wording after semantic checks pass. Unsupported conversions are not inferred.
- Semantic disagreement returns `unresolved`. An excerpt-relevance vote cannot override the reviewer's rejection of the generated claim. This prevents the observed fallback from answering a Northbridge question with a museum code. It can also refuse a flawed generated answer even when the sources contain the correct information; safety does not establish complete answer coverage.
- Inconclusive, malformed or unavailable review returns `unresolved`, rather than falsely claiming that the documents lack the information. Supported parts can be returned alongside gaps. Rejecting an irrelevant extra claim does not itself imply incomplete coverage.
- Laya Choice and Boolean checks remain in the policy path. Code retains numeric comparison and verdict combination; generated approval wording cannot override a failing calculated check.
- Headings such as “Maximum booking durations” are context, not standalone requirements. Matching per-session summary cards can be consolidated with detailed rules, preserving different units and periods.
- Numeric fact matching retains visitor quantities. When the initial extraction misses or invents a quantity, one bounded correction selects only from IDs of actual visitor excerpts. The application never substitutes a policy threshold for a visitor value.

No dependencies, schema migrations, credentials, or provider settings were added or changed in this update. The normal development database was not modified by the evaluations. The local checks below used no cloud calls; the separately authorized follow-up used exactly six Gemini calls, with no retries or provider fallbacks.

## Automated verification

- `npm test`: **52/52 passed**.
- `npm run build`: passed.
- The nine-PDF, three-organization isolation test still passes, including authenticated document operations and tenant-scoped model inputs.
- New regressions cover unrelated genuine quotes, negation and unit changes, invalid citations, corrected quotations, uncertain/unavailable reviews, mixed supported/unsupported requests, heading and duplicate-card handling, hyphenated visitor quantities, and numeric correction constrained to visitor excerpts.

These semantic tests use controlled model outputs. They test application behavior when a reviewer supplies those outputs; they do not establish a real model's accuracy.

## Live local evidence

All runs used `qwen3:1.7b-q4_K_M` and local Laya, with isolated evaluation data and no cloud calls.

The initial 13-case run passed **9/13** coarse checks. Harborlight booking, comparison, guest policy, reference code, unsupported membership fee, and 120-minute rejection passed. Northbridge hours and museum hours/mixed questions also passed. This run preceded the additional full-context quotation correction and numeric selection changes.

After those changes, four museum cases were rechecked:

| Case | Result |
| --- | --- |
| 32 participants against maximum 30 | Correct rejection after numeric fact correction selected the actual visitor excerpt. |
| Booking + group price + weekend closing time | Still incomplete. Individual pricing was suppressed, but an unrelated closure-date statement survived and the model did not repair its invalid weekend-hours quote. |
| Unsupported monkey-visit question | Incorrectly accepted an unrelated real closure-date quote. |
| Northbridge desk code requested through the museum assistant | Incorrectly answered with the museum's own code. No Northbridge source content was retrieved or exposed; this is a subject/relevance failure, not a cross-tenant document-access failure. |

An additional six-candidate adversarial review exposed false relevance decisions and invented replacement quotations. The server rejects invented quotations, but it cannot establish semantic relevance from exact matching alone.

Raw local reports are ignored by Git:

- `data/evaluation/verification-fix-live.json`
- `data/evaluation/verification-fix-museum.json`
- `data/evaluation/factual-review-adversarial.json`
- `data/evaluation/harborlight-decision-fixed.json`
- `data/evaluation/verification-fix-gemini.json`
- `data/evaluation/verification-fix-gemini-replay.json`

Ollama also encountered a GPU discovery failure and fell back to CPU during testing. Orphaned workers from the failed runs were cleaned up. Subsequent runs completed, but local responses were slow. The application, Laya, and Ollama services remain available.

## Authorized Gemini follow-up

Provider: `gemini-3.1-flash-lite`. A hard six-call limit and 13-second pacing were enforced; the script stopped at six and did not modify `.env`.

| Check | Live result | Result after final guards, using recorded outputs only |
| --- | --- | --- |
| Museum group booking, price and weekend closing time | Correct portal instructions, $6 per student, 18:00, with document/page references. | Retained. Conservative warnings about omitted candidate details remain. |
| Unsupported monkey question | Gemini rejected the unrelated closure-date quote. | `no_answer`, no references. |
| Northbridge code requested through the museum | Gemini marked the claim unsupported but marked a short museum-code excerpt relevant; the old fallback displayed it. | `unresolved`, no code or references displayed. No foreign organization's documents were accessed. |
| Deliberate 90-hours claim against 90-minute source | Gemini incorrectly marked the claim supported. | Server unit validation rejects the paraphrase and returns the verified 90-minute excerpt. |

One cloud call reviewed six adversarial candidates. Three calls ran the museum question through actual tenant-scoped retrieval, planning, composition and review in an isolated copy of the real knowledge base. Two calls reviewed captured failed Ollama drafts for unsupported and wrong-organization questions. The latter two were reviewer tests, not fresh Gemini answer generation. Registration, upload and browser UI were not rerun in this cloud check.

The final application guards were checked against those captured responses with network access forbidden in the replay. All six adversarial candidates were either answered safely or refused. That is a safety result, not six complete answers: the deliberately inverted permission claim now requires review, and the wrong-subject draft is rejected without recovering the available 180-minute answer.

Gemini improved the observed factual results but is not infallible. Confidently wrong semantic judgments remain possible, and the small Ollama model should not be presented as dependable for arbitrary verification. Existing limitations in policy scope, compound rules and positive semantic eligibility judgments remain; this update does not claim a general policy compiler or exhaustive accuracy validation. The app remains configured to use Ollama until the user changes providers.
