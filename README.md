# Reflog Query Language (RQL)

RQL is a query language for selecting and filtering entities. This repo defines the language in two specs and provides a reference implementation.

You can see a working [demo here](https://reflog-io.github.io/reflog-ql/).

## Specs (high level)

### [SPEC.md](SPEC.md) - JSON schema

The **canonical** form of an RQL query is JSON. The spec defines:

- **Entity** - Which entity type to query (e.g. `users`, `products`).
- **Limit** - Optional cap on the number of results.
- **Where** - A filter built from **comparisons** (`field`, `op`, `value`) and **and** / **or** logic (with nesting). Supports `=`, `!=`, `<`, `>`, `<=`, `>=`; dates/times as ISO 8601 strings.
- **Include** - Which related entities to load (e.g. `{ "reviews": true, "category": true }`).

Backends consume this JSON to run the query; the shape is stable and implementation-agnostic.

### [SPEC-PLAINTEXT.md](SPEC-PLAINTEXT.md) - Plain-text syntax

A **single-line, human-friendly** syntax that maps 1:1 to the RQL JSON. Intended for search bars, filter inputs, and URLs.

- **Format:** `key:value` clauses separated by spaces: `entity:product limit:10 include:reviews where:(status=published)`.
- **Where:** Comparisons use `field op value` or `field=value`; conditions are combined with spaces (AND) or the `OR` keyword; parentheses group and nest.
- **Values:** Unquoted tokens are inferred as number, boolean, or string; quoted strings allow spaces and force string type (including ISO 8601 dates).

Parsing plain text yields the same JSON structure as in [SPEC.md](SPEC.md), so one parser can power both UIs and APIs.

## Repo layout

| Path                                   | Description                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| [SPEC.md](SPEC.md)                     | Full RQL JSON specification                                                                                  |
| [SPEC-PLAINTEXT.md](SPEC-PLAINTEXT.md) | Plain-text syntax and mapping to JSON                                                                        |
| [javascript/](javascript/)             | TypeScript/JS implementation: parser, validator, autocomplete; [demo](javascript/demo/) with editable schema |

See [javascript/README.md](javascript/README.md) for install, API, and usage.
