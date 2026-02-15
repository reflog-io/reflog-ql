/**
 * Parser for RQL plain-text syntax → RQL JSON.
 */

import type { Schema } from "./schema.js";

/** Thrown when plain-text input is invalid or when the result is invalid according to the schema. */
export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

export interface RQLComparison {
  field: string;
  op: string;
  value: string | number | boolean;
}

export interface RQLCondition {
  and?: RQLCondition[];
  or?: RQLCondition[];
  field?: string;
  op?: string;
  value?: string | number | boolean;
}

export interface RQLOrderTerm {
  field: string;
  dir: "asc" | "desc";
}

export interface RQLQuery {
  entity?: string;
  limit?: number;
  order?: RQLOrderTerm[];
  include?: Record<string, boolean>;
  where?: RQLCondition;
}

function validateAgainstSchema(rql: RQLQuery, schema: Schema): void {
  if (!schema?.entities?.length) {
    return;
  }

  const entityNames = new Set(schema.entities.map((e) => e.name));

  // Validate entity exists in schema
  if (rql.entity) {
    if (!entityNames.has(rql.entity)) {
      throw new ParseError(
        `Unknown entity "${rql.entity}". Known entities: ${[
          ...entityNames,
        ].join(", ")}`,
      );
    }
  }

  const entityDef = schema.entities.find((e) => e.name === rql.entity);
  if (!entityDef) return;

  // Validate relations
  if (rql.include && Object.keys(rql.include).length > 0) {
    const allowed = new Set(entityDef.relations ?? []);
    for (const rel of Object.keys(rql.include)) {
      if (!allowed.has(rel)) {
        throw new ParseError(
          `Unknown relation "${rel}" for entity "${
            rql.entity
          }". Known relations: ${[...allowed].join(", ")}`,
        );
      }
    }
  }

  // Validate fields in where clause
  if (rql.where && entityDef.fields) {
    const allowedFields = new Set(Object.keys(entityDef.fields));
    const fieldErrors: string[] = [];
    function collectFields(cond: RQLCondition | undefined): void {
      if (!cond) return;
      if (cond.field !== undefined) {
        if (!allowedFields.has(cond.field)) fieldErrors.push(cond.field);
        return;
      }
      if (cond.and) for (const c of cond.and) collectFields(c);
      if (cond.or) for (const c of cond.or) collectFields(c);
    }
    collectFields(rql.where);
    const unknown = [...new Set(fieldErrors)];
    if (unknown.length > 0) {
      throw new ParseError(
        `Unknown field(s) for entity "${rql.entity}": ${unknown.join(
          ", ",
        )}. Known fields: ${[...allowedFields].join(", ")}`,
      );
    }
  }
}

const OPS = ["!=", "<=", ">=", "=", "<", ">"] as const;

function splitTopLevel(str: string): string[] {
  const clauses: string[] = [];
  let i = 0;
  while (i < str.length) {
    while (i < str.length && /\s/.test(str[i])) i++;
    if (i >= str.length) break;

    // Handle quoted strings
    if (str[i] === '"') {
      const start = i;
      i++;
      let foundClosing = false;
      while (i < str.length) {
        if (str[i] === "\\") {
          i += 2;
          continue;
        }
        if (str[i] === '"') {
          i++;
          foundClosing = true;
          break;
        }
        i++;
      }
      if (!foundClosing) {
        throw new ParseError("Unclosed quoted string");
      }
      clauses.push(str.slice(start, i));
      continue;
    }

    // Handle order: (value may contain spaces, e.g. "order:price asc,name")
    const orderPrefix = "order:";
    if (str.slice(i, i + orderPrefix.length) === orderPrefix) {
      const start = i;
      i += orderPrefix.length;
      // Consume until next key: (entity:, limit:, order:, include:, where:) or end
      const nextKey = /(\s)(entity|limit|order|include|where):/g;
      nextKey.lastIndex = i;
      const match = nextKey.exec(str);
      const end = match ? match.index : str.length;
      while (i < end && /\s/.test(str[i])) i++;
      clauses.push(str.slice(start, end));
      i = end;
      continue;
    }

    // Handle where clause with parentheses
    if (str.slice(i, i + 6) === "where:") {
      const start = i;
      i += 6;
      if (str[i] === "(") {
        let depth = 1;
        i++;
        while (i < str.length && depth > 0) {
          if (str[i] === "\\") {
            i += 2;
            continue;
          }
          if (str[i] === '"') {
            let foundClosing = false;
            i++;
            while (i < str.length) {
              if (str[i] === "\\") {
                i += 2;
                continue;
              }
              if (str[i] === '"') {
                i++;
                foundClosing = true;
                break;
              }
              i++;
            }
            if (!foundClosing) {
              throw new ParseError("Unclosed quoted string in where clause");
            }
            continue;
          }
          if (str[i] === "(") depth++;
          else if (str[i] === ")") depth--;
          i++;
        }
        if (depth !== 0) {
          throw new ParseError("Unbalanced parentheses in where clause");
        }
        clauses.push(str.slice(start, i));
        continue;
      }
    }

    // Handle regular tokens
    const start = i;
    while (i < str.length && !/\s/.test(str[i])) i++;
    clauses.push(str.slice(start, i));
  }
  return clauses;
}

function unwrapWhere(value: string): string {
  const s = value.trim();

  if (s.startsWith("(")) {
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "(") depth++;
      else if (s[i] === ")") depth--;
      if (depth < 0)
        throw new ParseError("Unbalanced parentheses in where clause");
      if (depth === 0 && i < s.length - 1)
        throw new ParseError("Unbalanced or invalid where expression");
    }
    if (depth !== 0)
      throw new ParseError("Unbalanced parentheses in where clause");
    if (!s.endsWith(")"))
      throw new ParseError("Unbalanced parentheses in where clause");
    return s.slice(1, -1).trim();
  }
  return s;
}

type WhereToken =
  | { type: "paren"; value: string }
  | { type: "keyword"; value: string }
  | { type: "op"; value: string }
  | { type: "ident"; value: string; raw: string }
  | { type: "string"; value: string }
  | { type: "number"; value: number }
  | { type: "boolean"; value: boolean };

function parseWhere(inner: string): RQLCondition {
  const tokens = tokenizeWhere(inner);
  if (tokens.length === 0) {
    throw new ParseError("Empty where clause");
  }
  let pos = 0;

  function parseOr(): RQLCondition | null {
    const left = parseAnd();
    if (pos >= tokens.length) return left;
    const t = tokens[pos];
    if (t.type === "keyword" && (t.value === "or" || t.value === "OR")) {
      if (left === null)
        throw new ParseError("Invalid where: OR with no left side");
      pos++;
      const right = parseOr();
      if (right === null)
        throw new ParseError("Invalid where: OR with no right side");
      // Flatten nested ORs for cleaner output
      const leftOrs = left.or ? left.or : [left];
      const rightOrs = right.or ? right.or : [right];
      return { or: [...leftOrs, ...rightOrs] };
    }
    return left;
  }

  function parseAnd(): RQLCondition | null {
    const terms: RQLCondition[] = [];
    let term = parsePrimary();
    if (!term) return term;
    terms.push(term);
    while (pos < tokens.length) {
      const t = tokens[pos];
      if (t.type === "keyword" && (t.value === "or" || t.value === "OR")) break;
      if (t.type === "keyword" && (t.value === "and" || t.value === "AND")) {
        pos++;
        term = parsePrimary();
        if (term === null)
          throw new ParseError("Invalid where: AND with no right side");
        terms.push(term);
        continue;
      }
      term = parsePrimary();
      if (!term) break;
      terms.push(term);
    }
    if (terms.length === 1) return terms[0];
    // Flatten nested ANDs for cleaner output
    const flattened: RQLCondition[] = [];
    for (const t of terms) {
      flattened.push(...(t.and ? t.and : [t]));
    }
    return { and: flattened };
  }

  function parsePrimary(): RQLCondition | null {
    if (pos >= tokens.length) return null;
    const t = tokens[pos];
    if (t.type === "paren" && t.value === "(") {
      pos++;
      const innerCond = parseOr();
      if (
        pos >= tokens.length ||
        tokens[pos].type !== "paren" ||
        tokens[pos].value !== ")"
      ) {
        throw new ParseError("Missing closing parenthesis");
      }
      pos++;
      if (innerCond === null) {
        throw new ParseError("Empty parenthetical expression");
      }
      return innerCond ?? null;
    }
    return parseComparison();
  }

  function parseComparison(): RQLCondition | null {
    if (pos >= tokens.length) return null;
    const fieldTok = tokens[pos];

    // Field should be an identifier or string
    if (fieldTok.type !== "ident" && fieldTok.type !== "string") {
      return null;
    }
    const field = fieldTok.type === "ident" ? fieldTok.raw : fieldTok.value;
    pos++;

    let op = "=";
    if (pos < tokens.length) {
      const ot = tokens[pos];
      if (ot.type === "op") {
        op = ot.value;
        pos++;
      }
    }

    if (pos >= tokens.length)
      throw new ParseError("Incomplete comparison in where clause");
    const valueTok = tokens[pos];
    if (
      valueTok.type !== "ident" &&
      valueTok.type !== "string" &&
      valueTok.type !== "number" &&
      valueTok.type !== "boolean"
    ) {
      throw new ParseError("Invalid value in where comparison");
    }
    pos++;

    // Extract typed value
    const value = valueTok.type === "ident" ? valueTok.raw : valueTok.value;

    return { field, op, value };
  }

  const result = parseOr();
  if (pos < tokens.length)
    throw new ParseError("Unbalanced or invalid where expression");
  if (result === null)
    throw new ParseError("Empty or invalid where expression");
  return result;
}

function tokenizeWhere(inner: string): WhereToken[] {
  const tokens: WhereToken[] = [];
  let i = 0;
  const s = inner;

  const skipWs = (): void => {
    while (i < s.length && /\s/.test(s[i])) i++;
  };

  while (i < s.length) {
    skipWs();
    if (i >= s.length) break;

    // Handle parentheses
    if (s[i] === "(") {
      tokens.push({ type: "paren", value: "(" });
      i++;
      continue;
    }
    if (s[i] === ")") {
      tokens.push({ type: "paren", value: ")" });
      i++;
      continue;
    }

    // Handle quoted strings
    if (s[i] === '"') {
      let val = "";
      let foundClosing = false;
      i++;
      while (i < s.length) {
        if (s[i] === "\\") {
          i++;
          if (s[i] === '"') val += '"';
          else if (s[i] === "\\") val += "\\";
          else val += s[i];
          i++;
          continue;
        }
        if (s[i] === '"') {
          i++;
          foundClosing = true;
          break;
        }
        val += s[i];
        i++;
      }
      if (!foundClosing) {
        throw new ParseError("Unclosed quoted string in where clause");
      }
      tokens.push({ type: "string", value: val });
      continue;
    }

    // Handle operators (check longest first)
    let opMatch: string | null = null;
    for (const op of OPS) {
      if (s.slice(i, i + op.length) === op) {
        opMatch = op;
        break;
      }
    }
    if (opMatch) {
      tokens.push({ type: "op", value: opMatch });
      i += opMatch.length;
      continue;
    }

    // Handle identifiers, keywords, numbers, booleans
    let word = "";
    const start = i;
    while (i < s.length && !/[\s()"=<>!]/.test(s[i])) {
      word += s[i];
      i++;
    }
    const raw = s.slice(start, i);
    if (!raw) {
      throw new ParseError("Unexpected character in where clause");
    }
    if (/^(?:and|or)$/i.test(raw)) {
      tokens.push({ type: "keyword", value: raw.toLowerCase() });
    } else if (/^true$/i.test(raw)) {
      tokens.push({ type: "boolean", value: true });
    } else if (/^false$/i.test(raw)) {
      tokens.push({ type: "boolean", value: false });
    } else if (/^-?\d+(\.\d+)?$/.test(raw)) {
      tokens.push({
        type: "number",
        value: raw.includes(".") ? parseFloat(raw) : parseInt(raw, 10),
      });
    } else {
      tokens.push({ type: "ident", value: raw, raw });
    }
  }
  return tokens;
}

/**
 * Parse RQL plain-text syntax into RQL JSON.
 */
export function parsePlainText(input: string, schema?: Schema): RQLQuery {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return {};

  const clauses = splitTopLevel(trimmed);
  const out: RQLQuery = {};

  for (const clause of clauses) {
    const colon = clause.indexOf(":");
    if (colon === -1) {
      throw new ParseError(
        `Invalid clause "${clause}": expected key:value format (e.g., entity:users). ` +
          `Valid keys: entity, limit, order, include, where`,
      );
    }
    const key = clause.slice(0, colon).trim().toLowerCase();
    const value = clause.slice(colon + 1).trim();

    if (key === "entity") {
      if ("entity" in out)
        throw new ParseError("Duplicate top-level key: entity");
      if (!value) throw new ParseError("entity value must be non-empty");
      out.entity = value;
    } else if (key === "limit") {
      if ("limit" in out)
        throw new ParseError("Duplicate top-level key: limit");
      if (!value) throw new ParseError("limit value must be non-empty");
      const n = parseInt(value, 10);
      if (Number.isNaN(n))
        throw new ParseError("limit must be a valid integer");
      if (n < 0) throw new ParseError("limit must be non-negative");
      // Ensure no decimal points or extra characters
      if (!/^\d+$/.test(value.trim())) {
        throw new ParseError("limit must be an integer without decimals");
      }
      out.limit = n;
    } else if (key === "order") {
      if ("order" in out)
        throw new ParseError("Duplicate top-level key: order");
      if (!value) throw new ParseError("order value must be non-empty");
      const terms: RQLOrderTerm[] = [];
      for (const part of value.split(",")) {
        const t = part.trim();
        if (!t) throw new ParseError("Empty term in order list");
        const tokens = t.split(/\s+/);
        const field = tokens[0];
        const fieldLower = field.toLowerCase();
        if (fieldLower === "asc" || fieldLower === "desc") {
          throw new ParseError(
            `Invalid order term "${field}": order must be a field name (e.g. order:name or order:created_at desc), not a direction alone.`,
          );
        }
        let dir: "asc" | "desc" = "asc";
        if (tokens.length >= 2) {
          const d = tokens[1].toLowerCase();
          if (d === "asc") dir = "asc";
          else if (d === "desc") dir = "desc";
          else throw new ParseError(`Invalid order direction "${tokens[1]}". Use asc or desc.`);
        }
        terms.push({ field, dir });
      }
      out.order = terms;
    } else if (key === "include") {
      if ("include" in out)
        throw new ParseError("Duplicate top-level key: include");
      if (!value) throw new ParseError("include value must be non-empty");
      out.include = {};
      for (const rel of value.split(",")) {
        const r = rel.trim();
        if (!r) throw new ParseError("Empty relation name in include list");
        out.include[r] = true;
      }
    } else if (key === "where") {
      if ("where" in out)
        throw new ParseError("Duplicate top-level key: where");
      if (!value) throw new ParseError("where value must be non-empty");
      const inner = unwrapWhere(value);
      out.where = parseWhere(inner);
    } else {
      throw new ParseError(
        `Unknown top-level key: "${key}". Valid keys: entity, limit, order, include, where`,
      );
    }
  }

  if (schema) validateAgainstSchema(out, schema);
  return out;
}

/**
 * Returns true if the string is valid RQL plain-text (and passes schema validation when schema is provided).
 */
export function isValidPlainText(input: string, schema?: Schema): boolean {
  try {
    parsePlainText(input, schema);
    return true;
  } catch (err) {
    if (err instanceof ParseError) return false;
    throw err;
  }
}
