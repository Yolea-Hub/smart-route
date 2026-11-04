# Contributing to Smart Route

Thank you for wanting to help. Smart Route is free and open source (Apache 2.0). [Version française](CONTRIBUTING.fr.md).

By taking part, you agree to the [code of conduct](CODE_OF_CONDUCT.en.md).

## Before you start

- A question? Open a "Question" issue or write to contact@yolea.ai.
- A bug? Open a "Bug" issue with your system, the Smart Route version and the steps to reproduce it.
- A security flaw? Do not post it: read [SECURITY.md](SECURITY.md).
- An idea? Open a "Feature to fund" issue. Features backed by the community are listed on [the Support page](https://smartroute.yolea.ai/en/support/).
- A large change? Talk to us in an issue before you write the code, so you do not lose time.

## Set up

Requirements: a recent Node.js and pnpm (the version is in `package.json`, field `packageManager`).

```
pnpm install --frozen-lockfile
pnpm dev          # run the app
pnpm test         # tests
pnpm typecheck    # types
pnpm build        # app + web version
```

## Project rules

- **Bilingual.** Every visible text (interface, error messages, documentation, site) exists in French and in English, French first. A screen or a page in one language only will not be accepted.
- **French typography.** Narrow no-break space (U+202F) before `;` `:` `!` `?` and inside « » quotation marks.
- **Sogoma.** The interface follows the Sogoma design system. Run `python3 -I tools/sogoma-check/sogoma_check.py`; it must report no error. Do not edit `kit/` or `tools/sogoma-check/` by hand: they are copied from the Sogoma repository.
- **Tests.** Every change of behaviour comes with a test. `pnpm test` and `pnpm typecheck` must pass.
- **Secure by default.** No secret in code, validated input, no shell with untrusted data. Runs started from the browser stay read-only.
- **No telemetry.** Smart Route sends nothing to Yolea. No contribution may add tracking or an unrequested network call.
- **Trademarks.** The names and logos of Yolea, Smart Route and third-party vendors are not under the Apache licence: see [NOTICE](NOTICE).

## Propose a change

1. Fork the repository, then create a short, descriptive branch.
2. Make small commits, with a message in English that says what changes and why.
3. Run the tests, the type check and sogoma-check.
4. Open a pull request with the template provided; link the issue it relates to.
5. A team member reviews it. We usually answer within a few days; a polite reminder is welcome.

## Licence of your contributions

Unless you state otherwise, any contribution you submit is published under the Apache 2.0 licence, like the rest of the project (section 5 of the licence).
