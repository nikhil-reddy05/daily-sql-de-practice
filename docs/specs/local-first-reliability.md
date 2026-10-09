# Spec: Local-First Reliability for Daily SQL & DE Practice

## Problem Statement

Daily SQL & DE Practice is a single-user, local-first learning app that delivers daily SQL problems and data-engineering scenarios, AI coach reviews, and adaptive progress tracking. Several implementation issues can undermine trust: the first-time ChatGPT OAuth handshake may fail, incomplete AI streams can be mistaken for complete results, parallel daily requests may produce duplicate problems, the progress model can overcount revisions or combine topics across tracks, and AI-generated SQL answers are not independently verified.

The goal is reliability and an accurate learning experience **without** introducing unnecessary accounts, multi-user permissions, hosted infrastructure, or GitHub Actions.

## Solution

Keep the current **Today / Progress / Setup** experience, SQLite persistence, optional ChatGPT sign-in, alternate API-key providers, and offline seed-bank fallback. Harden external-provider interactions and local credential storage, make daily question sets atomic, improve statistics and feedback transparency, and validate user-visible behavior with local tests.

## User Stories

1. As a learner, I want to use the app locally without creating a practice account, so that I can immediately start.
2. As a learner, I want the server to listen only on my machine by default, so that other network devices cannot access it.
3. As a learner, I want to sign in with ChatGPT on first use, so that eligible plan-backed AI is available.
4. As a learner, I want returning sign-in and refresh to be reliable, so that I can continue practice.
5. As a learner, I want OAuth state, PKCE, nonce, issuer, signature, audience, and resource/client identity verified, so that credentials remain protected.
6. As a learner, I want stored OAuth tokens encrypted with a key separate from the database, so that copying the database alone cannot reveal them.
7. As a learner, I want clear messages for expired sessions, ineligible plans, and usage limits, so that I know what to do.
8. As a learner, I want an explicitly configured provider fallback when appropriate, so that an AI outage doesn't unnecessarily block practice.
9. As a learner, I want incomplete, failed, disconnected, or timed-out AI responses rejected, so that broken output is never presented as complete.
10. As a learner, I want one daily set even when I refresh or open multiple tabs, so that today's work stays consistent.
11. As a learner, I want failed generation to leave no half-saved question set, so that retries are safe.
12. As a learner, I want regeneration blocked after I submit an answer, so that my work is preserved.
13. As a learner, I want AI-generated SQL questions to honor my selected dialect, so that syntax is relevant.
14. As a learner, I want seed-bank SQL questions identified as PostgreSQL-flavored, so that fallback content does not misrepresent its dialect.
15. As a learner, I want unique questions within a seed-generated day, so that repetition isn't silently introduced when my requested count exceeds the available bank.
16. As a learner, I want SQL topic scores separated from data-engineering topic scores, so that weaknesses and recommendations are accurate.
17. As a learner, I want every revision saved without counting one question repeatedly toward mastery, so that my adaptive difficulty isn't distorted.
18. As a learner, I want AI scores clearly identified as advisory rather than execution-verified, so that I understand how much to trust them.
19. As a learner, I want my submitted answer retained if grading fails, so that I don't lose effort.
20. As a learner, I want to retry an unsuccessful review without retyping, so that transient AI errors are recoverable.
21. As a learner, I want correct runtime requirements and convenient local commands, so that installation, builds, and tests are predictable.

## Implementation Decisions

- **Product boundary:** Single-user and local-first. Keep a shared local SQLite practice database. Do not add application accounts, roles, per-user practice-data isolation, or authentication requirements for ordinary practice records.
- **Network and browser boundary:** Bind the HTTP server to loopback by default. Add lightweight origin/CSRF protections for state-changing requests where browser-to-localhost attacks are plausible; preserve OAuth state validation.
- **OAuth:** Keep authorization-code + PKCE and verify the dynamic client-ID lifecycle, token exchange parameters, resource value, and ID-token audience against current OpenAI guidance. Test first and subsequent logins; only advertise plan-backed usage when actually available.
- **Credentials:** Keep authenticated encryption for tokens while keeping its key separate from SQLite. Document configuration, backup, loss-of-key handling, sign-out, and token clearing.
- **AI streaming:** Require a successful terminal completion event. Reject failed or incomplete streams and timeouts across the entire request *including response-body consumption*. Preserve submitted answers on review errors and display actionable errors.
- **Daily question integrity:** Coordinate concurrent generation by local date. Store a complete validated daily set and its source atomically; add uniqueness safeguards on date and ordinal. Failed generation must not leave partial questions.
- **Regeneration:** Only allow replacing today's set while it has no attempts. Ensure all relevant writes are transactional.
- **Seed fallback:** Rotate through available seed problems without within-day duplicates. When requested counts exceed distinct bank capacity, clearly cap/communicate availability rather than repeat silently.
- **Dialect contract:** Apply dialect selection only to AI-generated SQL; label fallback questions correctly and correct misleading dialect-specific prompt examples. Validate generated question structure and counts.
- **Adaptive progress:** Identify topics by both track and name. Keep all attempts, but compute mastery with one effective scored result per challenge (latest scored attempt), and separate first-attempt performance if useful. Rebuild derived statistics safely after migration.
- **Grading transparency:** AI-produced SQL reviews are advisory until a separately scoped isolated SQL execution and expected-results comparator is designed and implemented. Avoid claiming execution-based correctness now.
- **Runtime and developer workflow:** Specify a Node version compatible with the built-in SQLite module, align engine constraints and documentation, and provide local build/test checks. No mandatory GitHub Actions.

## Testing Decisions

**Primary test seam (proposed):** Exercise existing HTTP endpoints against temporary SQLite state, with external OAuth and AI providers mocked. Prefer behavioral assertions on requests, responses, persisted questions, and progress over testing implementation details. Keep the current fast `node:test` tests for pure helpers.

Expected regression coverage:

- First-time OAuth dynamic-client registration, repeat sign-in, refresh, invalid nonce/state/audience, and credential clearing.
- Successful SSE completion versus failure, incomplete termination, early connection close, and timeout.
- Concurrent first visits returning one complete daily set and atomic rollback after generation failure.
- Regeneration before attempts succeeding and after attempts preserving all work.
- Settings/dialect validation, offline seed uniqueness and overflow behavior.
- Distinct track/topic statistics; repeated revisions not inflating mastery.
- Offline answers retained without fabricated AI reviews; retry failed grading.
- Local-only binding, state-changing request protections, and documented supported Node runtime.

**Prior art:** Existing auth, plan-client, and core unit tests already exercise PKCE/JWT, SSE assembly, seed rotation, prompt payload validation, settings, and adaptive difficulty. Extend those tests and add only the minimal higher-level test harness needed.

**Test-seam decision to confirm before implementation:** HTTP boundary + temporary SQLite + mocked provider responses; no end-to-end calls that consume live ChatGPT quota.

## Out of Scope

- Multi-user accounts or practice-data partitioning.
- Cloud deployment, hosted operations, synchronization, and collaboration.
- GitHub Actions or other required CI/CD.
- Wholesale UI redesign or new architectural framework.
- Complete SQL execution sandboxes for six dialects in this hardening pass.
- Large seed-bank expansion before existing behavior is reliable.

## Further Notes

- Repository: https://github.com/nikhil-reddy05/daily-sql-de-practice
- Derived from the repository review and clarified decisions: **single user, local-first, no app-data authentication, no mandatory GitHub Actions**.
- Implementation order: OAuth and streaming completion; atomic daily generation; adaptive stats; seed/dialect consistency; runtime documentation and local tests. SQL execution-based grading can be a distinct later spec.
- This is a specification, not a claim that the fixes have been implemented.
