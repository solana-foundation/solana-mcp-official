# Contributing

The Solana MCP server is developed in public and we appreciate contributions. See [`README.md`](./README.md) for the architecture and local development setup.

## Pull requests

Open an issue first and wait for a maintainer to label it `accepted`. Every pull request has to reference such an issue with `Fixes #<issue>`; CI labels the ones that don't `needs-issue` and closes them, with the exception of typos, broken links, and comment-only fixes, which declare `Linked issue: trivial` in the description instead. Agreeing on the approach before anyone writes code is what keeps a finished change from being rejected on scope.

All commits into a Solana Foundation repository require [commit signature verification](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification) to be enabled. CI requests changes on a pull request carrying an unverified commit and dismisses that review once every commit verifies.

Fill in every section of the [pull request template](./.github/PULL_REQUEST_TEMPLATE.md): the problem, the approach, how you tested it, and the [AI disclosure](#disclosure). Link related issues and call out behavior changes, compatibility concerns, or follow-up work. CI fails the PR until the disclosure is declared.

Use [Conventional Commits](https://www.conventionalcommits.org/) for commit and PR titles. Run `pnpm typecheck`, `pnpm lint`, and `pnpm test` before opening a pull request, and keep the change focused on one problem.

By default, [Greptile](https://www.greptile.com) is enabled on all Solana Foundation repositories. Before maintainers review, all Greptile comments must be resolved with either a code fix or an explanation of why no change is needed.

## AI use

You may use AI-assisted tools, but you should review the generated code, understand its behavior, and run the same checks expected of any other contribution.

This repository ships [`AGENTS.md`](./AGENTS.md), which carries the repo's conventions for coding agents. Point your tooling at it rather than rediscovering the codebase from scratch.

Ensure that the generated code adheres to the project's coding standards and best practices. Maintainers can close PRs if they appear to be low-effort AI slop. In particular, audit your changes for the following AI code smells that increase maintenance burden:

- Comments that explain why the _previous_ behavior was wrong and the new behavior is correct. This can be helpful context for reviewers as a GitHub comment in the review, but we do not need a history of every code change living in the codebase.
- Large blocks of comments with high density of technical jargon; comments should be distilled to clearly explain _why_ this code is doing something (if it's not obvious), not _what_ (the code should speak for itself).
- Drive-by refactoring of code that is not relevant to the actual change being made.

You must be able to explain every line of your diff without an LLM. Reviewers may ask you a pointed question about any part of the change; if the answer is pasted from a model or does not come, the PR is closed.

Tool attribution left in a PR (a `Generated with Claude Code` footer, a `Co-Authored-By: Claude` trailer, a `cursor/` or `codex/` branch, and the like) tells us the submission was opened without being read. CI labels these `ai-unreviewed`, fails the check, and explains what to fix. PRs left in that state are closed.

### Disclosure

Disclosure is required. The pull request template has two boxes; check exactly one. If AI tooling was used, name the tool and the extent, for example:

> I wrote all of the code for this feature, and had Claude update the documentation and create tests accordingly

or

> I architected the change and handed all implementation over to Codex

Editor autocomplete of single keywords or short phrases does not count as AI tooling.

### Communication

If maintainers have suggested changes, feedback, or questions about your code, you should not be copy/pasting the questions to an LLM and copy/pasting the response. You being able to distill the information that AI produces is what makes your contribution valuable.
