# RQL Plain-Text Syntax - Specification

A single-line, human-friendly syntax that maps to the [RQL JSON schema](SPEC.md). Designed for use in a single text input (e.g. search/filter bar, like Datadog).

---

## Design goals

- **Single line:** No newlines; everything typable in one input.
- **Scannable:** `key:value` pairs are easy to read and parse.
- **Where clause:** Expressive enough for comparisons and AND/OR (including nesting) without requiring a textarea.
- **Quoting:** Values with spaces or special characters can be quoted so the grammar stays unambiguous.

---

## Top-level keys

All top-level clauses use the form **`key:value`**. Keys are fixed; order is irrelevant. Spaces separate clauses.

| Key     | Plain-text form | Maps to RQL                                    |
| ------- | --------------- | ---------------------------------------------- |
| Entity  | `entity:name`   | `entity`                                       |
| Limit   | `limit:N`       | `limit`                                        |
| Include | `include:a,b,c` | `include: { "a": true, "b": true, "c": true }` |
| Where   | `where:(...)`   | `where`                                        |

**Examples:**

```
entity:users
entity:users limit:10
entity:products limit:20 include:reviews,category
entity:users limit:5 where:(status=active)
```

- **entity** - Required in practice (omitted = invalid or "all" per implementation).
- **limit** - Non-negative integer.
- **include** - Comma-separated list of relation names; each becomes `true` in the RQL `include` object.
- **where** - See [Where clause](#where-clause) below.

---

## Where clause

The `where` value is everything inside the parentheses after `where:`. It is a small expression language that maps to RQL's condition tree (comparisons + `and` / `or`).

### Comparisons

A comparison is: **`field op value`** or **`field=value`** (equality shorthand).

- **Operators:** `=`, `!=`, `<`, `>`, `<=`, `>=`.
- **Value:** Unquoted token or quoted string. Type is inferred from the token (see below), or forced to string when quoted.

### Value types (unquoted vs quoted)

| Unquoted token   | Interpreted as | Example                       |
| ---------------- | -------------- | ----------------------------- |
| `true` / `false` | Boolean        | `verified=true`               |
| Numeric literal  | Number         | `age>=18`, `price<99.99`      |
| Anything else    | String         | `status=active`, `role=admin` |

**Unquoted rules:**

- **Boolean:** The tokens `true` and `false` (case-insensitive) are parsed as booleans.
  `verified=true`, `active=false`
- **Number:** A token that matches a number (integer or decimal) is parsed as a number.
  `age>=18`, `price<100`, `score<=3.14`
- **String:** Any other unquoted token is a string (identifiers, labels, etc.).
  `status=active`, `role=admin`, `category=electronics`

**Quoted values:** Always parsed as **strings**. Use quotes when:

- The value contains spaces or characters that would break tokenization: `name="Alice Smith"`.
- You need to force a string that would otherwise be interpreted as number or boolean:
  `id="18"` (string `"18"`), `flag="true"` (string `"true"`).
- The value is a **date or datetime** (ISO 8601): `created_at>="2024-01-01"`, `published_at<"2024-02-06T12:00:00Z"`. Date/time values are always quoted so they parse as strings and are interpreted per the [RQL dates and times](SPEC.md#dates-and-times) rules.

Use double quotes; escape `"` and `\` inside with `\`.

- `name="Alice"`
- `title="Hello \"World\""`
- `id="18"` → RQL value is string `"18"`, not number `18`
- `created_at>="2024-01-01"` → date comparison (ISO 8601)

### Combining conditions: AND / OR

- **AND:** Space between conditions means AND.
  `where:(status=active age>=18)` → both must hold.

- **OR:** Use the keyword `OR` (case-insensitive).
  `where:(status=active OR status=pending)` → either holds.

- **Grouping:** Use parentheses inside the `where:(...)` to nest logic.
  `where:((status=admin) OR (age>=18 AND verified=true))` → maps to RQL `or` with two children: one comparison, one `and` of two comparisons.

**Precedence:** `AND` binds tighter than `OR`. So:

- `a OR b AND c` → `a OR (b AND c)`
- Use parentheses when in doubt: `where:((a OR b) AND c)`

**Examples:**

```
where:(status=active age>=18)
where:(role=admin OR role=moderator)
where:(price<100 stock>0 category!=archived)
where:((role=admin) OR (age>=18 AND verified=true))
```

### Mapping to RQL

- A single comparison → one RQL comparison object: `{ "field", "op", "value" }`.
- Space-separated comparisons (no `OR` between them) → one RQL `and` node containing those comparisons.
- `OR`-separated expressions → one RQL `or` node; each side can be a comparison or a parenthesized group (which may map to `and` or `or`).
- Nested parentheses → nested `and`/`or` in RQL.

---

## Full example

**Plain text:**

```
entity:products limit:20 include:reviews,category where:(price<100 stock>0 category!=archived)
```

**Maps to RQL:**

```json
{
  "entity": "products",
  "limit": 20,
  "include": { "reviews": true, "category": true },
  "where": {
    "and": [
      { "field": "price", "op": "<", "value": 100 },
      { "field": "stock", "op": ">", "value": 0 },
      { "field": "category", "op": "!=", "value": "archived" }
    ]
  }
}
```

**Another (with OR and grouping):**

**Plain text:**

```
entity:users limit:10 where:((role=admin) OR (age>=18 AND verified=true))
```

**Maps to RQL:**

```json
{
  "entity": "users",
  "limit": 10,
  "where": {
    "or": [
      { "field": "role", "op": "=", "value": "admin" },
      {
        "and": [
          { "field": "age", "op": ">=", "value": 18 },
          { "field": "verified", "op": "=", "value": true }
        ]
      }
    ]
  }
}
```

---

## Lexing and parsing notes

1. **Split top-level clauses** by spaces, but respect quoted strings so that e.g. `where:(title="Hello World")` is one clause.
2. **Key:value:** For each clause, the first `:` separates key from value. So `entity:users`, `limit:10`, `include:a,b`, `where:(...)`.
3. **Where expression:** After stripping `where:(` and the closing `)`, parse the inner string as a condition expression: tokens (including quoted strings), operators (`=`, `!=`, `<`, `>`, `<=`, `>=`), and keywords `AND` / `OR`, with parentheses for grouping.
4. **Value types:** Unquoted numeric tokens → number; `true`/`false` → boolean; otherwise string. Quoted → string.
5. **Whitespace:** Ignore spaces between tokens; spaces are not part of values except inside quotes.

---

## Summary

| Concept        | Plain-text example                 | Notes                                                |
| -------------- | ---------------------------------- | ---------------------------------------------------- |
| Entity         | `entity:users`                     | Required.                                            |
| Limit          | `limit:10`                         | Integer ≥ 0.                                         |
| Include        | `include:comments,articles`        | Comma-separated relations.                           |
| Where (simple) | `where:(status=active)`            | One comparison.                                      |
| Where (AND)    | `where:(a=1 b=2)`                  | Space = AND.                                         |
| Where (OR)     | `where:(a=1 OR b=2)`               | Keyword OR.                                          |
| Where (nested) | `where:((a=1 OR a=2) AND b=3)`     | Parentheses for grouping.                            |
| Quoted value   | `where:(name="Alice Smith")`       | For spaces/special chars.                            |
| Number/boolean | `where:(age>=18 verified=true)`    | Unquoted; type inferred. Use quotes to force string. |
| Date/datetime  | `where:(created_at>="2024-01-01")` | Quoted ISO 8601 strings; chronological comparison.   |

This keeps the bar to a single line while mapping cleanly onto the RQL JSON schema.
