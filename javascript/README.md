# reflog-ql

RQL (Reflog Query Language) - a query language with a **JSON schema** and a **single-line plain-text syntax** for use in search/filter bars (e.g. Datadog-style). This package provides a parser, validator, and autocomplete driven by a TypeScript schema (entities, relations, and fields).

## Install

```bash
npm install reflog-ql
```

**Repository layout:** Source and tests live in **`javascript/`**: `javascript/src/` (TypeScript), `javascript/demo/` (demo app), and built output in `javascript/dist/`. From the repo root, all scripts delegate to `javascript/`; you can also `cd javascript` and run `npm run build`, `npm run test`, `npm run demo` there.

## Plain-text syntax (summary)

- **`entity:name`** - Entity type to query (required in practice).
- **`limit:N`** - Max number of results (non-negative integer).
- **`include:a,b,c`** - Comma-separated relation names to load.
- **`where:(...)`** - Filter expression: comparisons (`field=value`, `field>=value`), space = AND, `OR` keyword, parentheses for grouping. Use `"..."` for values with spaces.

**Examples:**

```
entity:users
entity:users limit:10
entity:products limit:20 include:reviews,category
entity:users where:(status=active age>=18)
entity:users where:((role=admin) OR (age>=18 AND verified=true))
```

See [SPEC-PLAINTEXT.md](../SPEC-PLAINTEXT.md) and [SPEC.md](../SPEC.md) for the full grammar and RQL JSON shape.

---

## API

### Exports

| Export             | Description                                                                             |
| ------------------ | --------------------------------------------------------------------------------------- |
| **Parser**         | `parsePlainText`, `isValidPlainText`, `ParseError`                                      |
| **Types (parser)** | `RQLQuery`, `RQLCondition`, `RQLComparison`                                             |
| **Schema**         | `Schema`, `EntityDef`, `FieldDef`, `defineSchema`, `exampleSchema`                      |
| **Autocomplete**   | `getContext`, `getSuggestions`, `getSuggestionsAtCursor`, `CursorContext`, `Suggestion` |

---

## Usage

### Parsing plain-text → RQL JSON

```js
import { parsePlainText, ParseError, isValidPlainText } from "reflog-ql";

// Parse (optionally with schema for validation)
const rql = parsePlainText(
  "entity:users limit:10 where:(status=active)",
  schema,
);
// → { entity: 'users', limit: 10, where: { field: 'status', op: '=', value: 'active' } }

// Validate without throwing
isValidPlainText("entity:users"); // true
isValidPlainText("entity:users entity:x"); // false (duplicate entity)

// Invalid input throws ParseError
try {
  parsePlainText("entity:users limit:-1");
} catch (err) {
  console.log(err.name); // 'ParseError'
  console.log(err.message); // 'limit must be non-negative'
}
```

- **`parsePlainText(input, schema?)`** - Returns `RQLQuery`. If `schema` is provided, validates entity, relations, and where-fields. Throws `ParseError` on invalid input.
- **`isValidPlainText(input, schema?)`** - Returns `true`/`false`. Does not throw.

---

### Schema

Used by the parser (validation) and autocomplete (suggestions).

```js
import { defineSchema, exampleSchema } from "reflog-ql";
```

- **`Schema`** - `{ entities: EntityDef[] }`
- **`EntityDef`** - `{ name: string; relations?: string[]; fields?: Record<string, FieldDef> }`
- **`FieldDef`** - `{ type?: 'string' | 'number' | 'boolean'; values?: string[] }` - `values` are used for where-value suggestions (e.g. enum).
- **`defineSchema(entities)`** - Builds a `Schema` from an array of entity definitions.
- **`exampleSchema`** - Predefined schema with `user`, `users`, `product`, `products`.

---

### Autocomplete

Suggestions are **filtered by prefix**: e.g. `entity:U` returns only entities whose name starts with `U`; after `entity:User ` typing `w` returns only `where:(` among top-level keys.

```bash
npm run build
```

```js
import {
  getSuggestionsAtCursor,
  getContext,
  getSuggestions,
  exampleSchema,
  defineSchema,
} from "reflog-ql";
```

**One call: suggestions at cursor**

```js
const suggestions = getSuggestionsAtCursor("entity:u", 8, exampleSchema);
// → [{ label: 'user', insertText: 'user', replaceLength: 1 }, ... ]
```

**Two-step: context then suggestions**

```js
const context = getContext("entity:user include:po", 22);
// → { kind: 'include-value', partial: 'po', entityValue: 'user' }

const suggestions = getSuggestions(context, exampleSchema);
// → [{ label: 'posts', insertText: 'posts', replaceLength: 2 }, { label: 'profile', ... }]
```

**Functions**

- **`getContext(query, cursor)`** - Returns `CursorContext`: where the cursor is (top-level, entity-value, include-value, where-field, where-value, etc.) and the current `partial` (and `usedKeys`, `entityValue`, `field`/`op` where applicable).
- **`getSuggestions(context, schema)`** - Returns `Suggestion[]` for that context, filtered by `context.partial`.
- **`getSuggestionsAtCursor(query, cursor, schema)`** - Convenience: `getSuggestions(getContext(query, cursor), schema)`.

**Suggestion shape**

| Property         | Type     | Description                                                                                                                                                                                                                                       |
| ---------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `label`          | string   | Display text (e.g. in a dropdown).                                                                                                                                                                                                                |
| `insertText`     | string   | Text to insert.                                                                                                                                                                                                                                   |
| `replacePartial` | boolean? | Default `true`. When `false`, insert at cursor without replacing the partial (e.g. operator after a field name).                                                                                                                                  |
| `replaceLength`  | number?  | When replacing: number of characters before the cursor to replace with `insertText`. Use for replacement: `value.slice(0, cursor - replaceLength) + s.insertText + value.slice(cursor)`. When `replacePartial === false`, `replaceLength` is `0`. |

**CursorContext kinds**

| `context.kind`  | When                  | Extra fields                 | Suggestions                                                                   |
| --------------- | --------------------- | ---------------------------- | ----------------------------------------------------------------------------- |
| `top-level`     | Empty or typing a key | `usedKeys: string[]`         | `entity:`, `limit:`, `include:`, `where:(` (unused only; filtered by partial) |
| `entity-value`  | After `entity:`       | -                            | Entity names (prefix-filtered)                                                |
| `limit-value`   | After `limit:`        | -                            | (none)                                                                        |
| `include-value` | After `include:`      | `entityValue: string`        | Relation names for entity (prefix-filtered)                                   |
| `where-field`   | Inside `where:(`      | `entityValue: string`        | Field names, or operators if partial is exact field name (prefix-filtered)    |
| `where-value`   | After `field op`      | `entityValue`, `field`, `op` | Values from `fields[field].values` when set (prefix-filtered)                 |
| `unknown`       | Unknown key           | -                            | (none)                                                                        |

**Custom schema**

```js
const schema = defineSchema([
  {
    name: "order",
    relations: ["items", "customer"],
    fields: {
      status: { type: "string", values: ["pending", "shipped", "cancelled"] },
      total: { type: "number" },
    },
  },
]);

const suggestions = getSuggestionsAtCursor(
  "entity:order where:(status=pen",
  28,
  schema,
);
// → [{ label: 'pending', insertText: 'pending', replaceLength: 3 }, ...]
```

In a UI: call `getSuggestionsAtCursor(inputValue, selectionStart, schema)` on input/focus, render the list (e.g. by `label`), and on selection apply the suggestion using `insertText` and `replaceLength` (or `replacePartial: false` and insert only).

---

## Demo

A small HTML demo lets you try the parser, validation, and autocomplete in the browser.

1. **Build** (so `javascript/dist/` exists): `npm run build`
2. **Serve and open**: `npm run demo` - builds, then serves `javascript/` at http://localhost:5000. Open **http://localhost:5000/demo/index.html**.

In the demo:

- **Input** - Type a plain-text query. The box gets a **red border** when the text is invalid.
- **Autocomplete** - Suggestions appear below the input as you type; click one or use **↑/↓** and **Enter** to replace the current token.
- **Parse to JSON** - Click the button or press Enter (with no suggestion selected) to see the parsed RQL JSON below.

---

## Scripts

| Command         | Description                                   |
| --------------- | --------------------------------------------- |
| `npm run build` | Compile TypeScript (`src/` → `dist/`)         |
| `npm run test`  | Build, then run parser and autocomplete tests |
| `npm run demo`  | Build, serve at :5000, and open demo          |

---

## Specs

- **[SPEC.md](../SPEC.md)** - RQL JSON schema (entity, where, include, limit).
- **[SPEC-PLAINTEXT.md](../SPEC-PLAINTEXT.md)** - Plain-text grammar and value types (strings, numbers, booleans, quoting).
