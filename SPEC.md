# Reflog Query Language (RQL) - Specification

A JSON-based query language for querying databases.

---

## Basics

### Entity selection

Select all entities of a given name:

```json
{ "entity": "name" }
```

**Semantics:** Returns all entities whose type/name is `"name"`.

---

### Limit

Restrict the number of results returned:

```json
{ "entity": "name", "limit": 10 }
```

**Semantics:** Returns at most 10 entities of type `"name"`.

- `limit` must be a non-negative integer.
- If omitted, no limit is applied (all matching entities are returned).

---

## Where (filters)

The `where` field restricts which entities are returned by combining **comparisons** with **and** / **or** (including nesting).

### Comparisons

A comparison has the form:

```json
{ "field": "<fieldname>", "op": "<operator>", "value": <value> }
```

| Operator | Meaning               |
| -------- | --------------------- |
| `"="`    | equal                 |
| `"!="`   | not equal             |
| `"<"`    | less than             |
| `">"`    | greater than          |
| `"<="`   | less than or equal    |
| `">="`   | greater than or equal |

**Equality shorthand:** When `op` is omitted, it defaults to `"="`. So `{ "field": "name", "value": "Alice" }` is equivalent to `{ "field": "name", "op": "=", "value": "Alice" }`.

**Examples:**

```json
{ "field": "status", "op": "=", "value": "active" }
{ "field": "age", "op": ">=", "value": 18 }
{ "field": "role", "op": "!=", "value": "guest" }
```

### Dates and times

Date and datetime values use **ISO 8601** strings.

- **Format:** Calendar dates as `YYYY-MM-DD`; datetimes as `YYYY-MM-DDTHH:mm:ss.sssZ` (UTC) or with an offset, e.g. `YYYY-MM-DDTHH:mm:ss+00:00`. Other valid ISO 8601 forms (e.g. time-only, week dates) are permitted; the backend may accept a subset.
- **Comparisons:** For fields the backend treats as date or datetime, the operators `<`, `>`, `<=`, `>=` compare in chronological order. Equality (`=`, `!=`) is exact string match of the normalized value; backend may normalize before comparing (e.g. compare instant in time for datetimes).
- **Examples:**

```json
{ "field": "created_at", "op": ">=", "value": "2024-01-01" }
{ "field": "published_at", "op": "<", "value": "2024-02-06T12:00:00Z" }
{ "field": "date", "op": "=", "value": "2024-01-15" }
```

### And / Or

- **And** - all nested conditions must hold: `{ "and": [ <condition>, <condition>, ... ] }`
- **Or** - at least one nested condition must hold: `{ "or": [ <condition>, <condition>, ... ] }`

Each `<condition>` is either a **comparison** or another **and** / **or** object, so conditions can be nested arbitrarily.

**Example: _x_ or (_y_ and _z_)**

```json
{
  "entity": "users",
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

**Example: numeric and string comparisons**

```json
{
  "entity": "products",
  "where": {
    "and": [
      { "field": "price", "op": "<", "value": 100 },
      { "field": "stock", "op": ">", "value": 0 },
      { "field": "category", "op": "!=", "value": "archived" }
    ]
  },
  "limit": 20
}
```

### Semantics

- If `where` is omitted, no filter is applied (all entities of the given type are considered).
- For an entity to be returned, the root `where` condition must evaluate to true for that entity.
- Field names refer to properties on the entity; behavior for missing or null fields is implementation-defined (e.g. comparisons to null, or missing field treated as null).

---

## Include (related entities)

Request that related entities be loaded and returned with each result. The backend is responsible for resolving relationships and performing any joins; the query only declares _which_ relations to include.

```json
{ "include": { "comments": true, "articles": true } }
```

**Shape:** `include` is an object whose keys are relation names and whose values are booleans. A key set to `true` means “include this relation”; the backend attaches the related entity or list of entities to each result as defined by the schema.

**Example:**

```json
{
  "entity": "users",
  "include": { "comments": true, "articles": true },
  "limit": 10
}
```

**Semantics:**

- If `include` is omitted, no related entities are loaded (only the primary entity fields are returned).
- Valid relation names and the shape of included data are defined by the backend/schema.
- How relations are named (e.g. singular vs plural) and whether they return one or many entities is implementation-defined.

---

## Order (sorting)

Request that results be sorted by one or more fields.

```json
{ "order": [ { "field": "created_at", "dir": "desc" }, { "field": "name", "dir": "asc" } ] }
```

**Shape:** `order` is an array of objects, each with:

- **`field`** (string) – name of the field to sort by.
- **`dir`** (string) – `"asc"` (ascending) or `"desc"` (descending). Default is `"asc"` if omitted.

**Semantics:**

- If `order` is omitted, result order is implementation-defined (e.g. insertion order or undefined).
- Sorts are applied left-to-right: first by the first term, then by the second within equal first values, and so on.
- Field names refer to properties on the entity; behavior for missing or null values is implementation-defined.

**Example:**

```json
{
  "entity": "users",
  "order": [ { "field": "created_at", "dir": "desc" }, { "field": "name", "dir": "asc" } ],
  "limit": 10
}
```

---

## Query shape (summary)

| Field     | Type      | Required | Description                                       |
| --------- | --------- | -------- | ------------------------------------------------- |
| `entity`  | string    | yes      | Name/type of entities to query                    |
| `where`   | condition | no       | Filter (and/or + comparisons)                     |
| `include` | object    | no       | Related entities to load (relation name → `true`) |
| `order`   | array     | no       | Sort terms: `[{ "field", "dir": "asc" \| "desc" }, ...]` |
| `limit`   | integer   | no       | Max number of results (≥ 0)                       |

A **condition** is either:

- A **comparison:** `{ "field": string, "op": "=" \| "!=" \| "<" \| ">" \| "<=" \| ">=", "value": any }`, or
- A **logic node:** `{ "and": [ condition, ... ] }` or `{ "or": [ condition, ... ] }`.

---

_More sections (e.g. projections) may be added later._
