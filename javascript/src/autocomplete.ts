/**
 * Autocomplete for RQL plain-text: cursor context and suggestions from a schema.
 */

import type { Schema, EntityDef, FieldDef } from "./schema.js";

const TOP_LEVEL_KEYS = ["entity:", "limit:", "order:", "include:", "where:("] as const;
const WHERE_OPS = ["!=", "<=", ">=", "=", "<", ">"] as const; // Order matters: check longer ops first

interface SegmentResult {
  segment: string;
  startIndex: number;
}

interface WhereParseResult {
  kind: "field" | "value";
  partial: string;
  field?: string;
  op?: string;
}

interface Token {
  type: "paren" | "keyword" | "op" | "value" | "word";
  value: string;
}

/** Context at cursor: what the user is typing and where. */
export type CursorContext =
  | { kind: "top-level"; partial: string; usedKeys: string[] }
  | { kind: "entity-value"; partial: string }
  | { kind: "limit-value"; partial: string }
  | { kind: "order-value"; partial: string; entityValue: string; afterField?: boolean }
  | { kind: "include-value"; partial: string; entityValue: string }
  | { kind: "where-field"; partial: string; entityValue: string }
  | {
      kind: "where-value";
      partial: string;
      field: string;
      op: string;
      entityValue: string;
    }
  | { kind: "unknown"; partial: string };

/**
 * Returns the clause segment that contains the cursor.
 * Uses clause boundaries (entity:, limit:, include:, where:() so that
 * include values with spaces after commas and cursor-at-end of where stay in one segment.
 */
function getSegmentAtCursor(query: string, cursor: number): SegmentResult {
  const beforeCursor = query.slice(0, cursor);
  const len = beforeCursor.length;
  let i = 0;
  let lastClauseStart = 0;

  while (i < len) {
    // Skip whitespace
    while (i < len && /\s/.test(beforeCursor[i])) {
      i++;
    }
    if (i >= len) break;

    const clauseStart = i;

    // Quoted string (inside a value) – skip it
    if (beforeCursor[i] === '"') {
      i = skipQuotedString(beforeCursor, i);
      continue;
    }

    // where:( – clause start; cursor inside block means this segment contains cursor
    if (
      beforeCursor.slice(i, i + 6) === "where:" &&
      beforeCursor[i + 6] === "("
    ) {
      const endOfBlock = skipWhereBlock(beforeCursor, i);
      if (cursor <= endOfBlock) {
        return {
          segment: beforeCursor.slice(i, cursor),
          startIndex: i,
        };
      }
      // Cursor is past the where block – segment is the text after the block (top-level)
      return {
        segment: beforeCursor.slice(endOfBlock, cursor),
        startIndex: endOfBlock,
      };
    }

    // order: – value can contain spaces (e.g. "order:price asc,name"); skip until next key
    const orderPrefix = "order:";
    if (beforeCursor.slice(i, i + orderPrefix.length).toLowerCase() === orderPrefix) {
      lastClauseStart = clauseStart;
      const segmentEnd = findNextKeyStart(beforeCursor, i + orderPrefix.length);
      if (cursor < segmentEnd) {
        return {
          segment: beforeCursor.slice(i, cursor),
          startIndex: i,
        };
      }
      // Cursor at or past end of order value
      if (segmentEnd < len) {
        lastClauseStart = segmentEnd;
        i = segmentEnd;
        continue;
      }
      // Cursor at end of query: if trailing space and order value is empty ("order:" or "order: "), we're "after" order (top-level)
      if (cursor === len && /\s$/.test(beforeCursor)) {
        const orderValue = beforeCursor.slice(i + orderPrefix.length, segmentEnd).trim();
        if (orderValue === "") {
          lastClauseStart = len;
          i = len;
          continue;
        }
      }
      return {
        segment: beforeCursor.slice(i, cursor),
        startIndex: i,
      };
    }

    // entity:, limit:, include: – clause start
    const keyMatch = beforeCursor.slice(i).match(/^(entity|limit|include):/i);
    if (keyMatch) {
      lastClauseStart = clauseStart;
      const keyLen = keyMatch[0].length;
      i += keyLen;

      if (keyMatch[1].toLowerCase() === "include") {
        // Include value can contain commas and spaces; skip until next clause
        while (i < len) {
          while (i < len && /\s/.test(beforeCursor[i])) i++;
          if (i >= len) break;
          if (
            beforeCursor.slice(i, i + 6) === "where:" &&
            beforeCursor[i + 6] === "("
          )
            break;
          if (/^(entity|limit|order|include):/i.test(beforeCursor.slice(i))) break;
          if (beforeCursor[i] === '"') {
            i = skipQuotedString(beforeCursor, i);
            continue;
          }
          i++;
        }
      } else {
        // entity or limit value: until next whitespace
        while (i < len && !/\s/.test(beforeCursor[i])) i++;
      }
      continue;
    }

    // Not a known key (partial key being typed, e.g. "entity:User w") – segment is from here to cursor
    lastClauseStart = clauseStart;
    while (i < len && !/\s/.test(beforeCursor[i])) {
      i++;
    }
  }

  // Cursor at end of query with trailing whitespace = between clauses (top-level)
  if (cursor === query.length && len > 0 && /\s$/.test(beforeCursor)) {
    return { segment: "", startIndex: len };
  }

  return {
    segment: beforeCursor.slice(lastClauseStart),
    startIndex: lastClauseStart,
  };
}

/**
 * Find the start index of the next top-level key (space followed by entity|limit|order|include|where:).
 * Returns s.length if none found.
 */
function findNextKeyStart(s: string, fromIndex: number): number {
  const re = /\s(entity|limit|order|include|where):/gi;
  re.lastIndex = fromIndex;
  const match = re.exec(s);
  return match ? match.index : s.length;
}

/**
 * Skip past a quoted string, handling escape sequences.
 * Returns the index after the closing quote, or end of string.
 */
function skipQuotedString(s: string, startIndex: number): number {
  let i = startIndex + 1; // Skip opening quote
  while (i < s.length) {
    if (s[i] === "\\") {
      i += 2; // Skip escape sequence
      continue;
    }
    if (s[i] === '"') {
      return i + 1; // Return index after closing quote
    }
    i++;
  }
  return i; // Unclosed quote
}

/**
 * Skip past a where:(...) block, handling nested parens and quotes.
 * Returns the index after the closing paren, or end of string.
 */
function skipWhereBlock(s: string, startIndex: number): number {
  let i = startIndex + 6; // Skip 'where:'
  if (s[i] !== "(") return i;

  let depth = 1;
  i++; // Skip opening paren

  while (i < s.length && depth > 0) {
    if (s[i] === "\\") {
      i += 2;
      continue;
    }
    if (s[i] === '"') {
      i = skipQuotedString(s, i);
      continue;
    }
    if (s[i] === "(") depth++;
    else if (s[i] === ")") depth--;
    i++;
  }

  return i;
}

/** Extract entity value from query (first entity:xxx, possibly incomplete). */
function getEntityValueFromQuery(query: string): string {
  const match = query.match(/entity:([^\s]*)/);
  return match?.[1]?.trim() ?? "";
}

/**
 * Returns top-level keys (entity, limit, order, include, where) already present in the query.
 */
function getTopLevelKeysUsed(query: string): string[] {
  const keys = new Set<string>();
  let i = 0;

  while (i < query.length) {
    // Skip whitespace
    while (i < query.length && /\s/.test(query[i])) {
      i++;
    }
    if (i >= query.length) break;

    // Skip quoted strings
    if (query[i] === '"') {
      i = skipQuotedString(query, i);
      continue;
    }

    // Handle where:(...) specially
    if (query.slice(i, i + 6) === "where:") {
      keys.add("where");
      i = skipWhereBlock(query, i);
      continue;
    }

    // Handle order: specially (value can contain spaces)
    if (query.slice(i, i + 6).toLowerCase() === "order:") {
      keys.add("order");
      i = findNextKeyStart(query, i + 6);
      continue;
    }

    // Extract key:value pair
    const start = i;
    while (i < query.length && !/\s/.test(query[i])) {
      i++;
    }

    const segment = query.slice(start, i);
    const colonIndex = segment.indexOf(":");
    if (colonIndex !== -1) {
      const key = segment.slice(0, colonIndex).trim().toLowerCase();
      if (key === "entity" || key === "limit" || key === "include") {
        keys.add(key);
      }
    }
  }

  return Array.from(keys);
}

/**
 * Parse the inner content of where:(...) for autocomplete.
 * Returns what we're editing (field, op, or value) and partial text.
 */
function parseWhereInner(inner: string): WhereParseResult {
  const trimmed = inner.trimEnd();
  if (!trimmed) {
    return { kind: "field", partial: "" };
  }

  const tokens = tokenizeWhereInner(trimmed);
  if (tokens.length === 0) {
    return { kind: "field", partial: "" };
  }

  const last = tokens[tokens.length - 1];
  const prev = tokens[tokens.length - 2];
  const prevPrev = tokens[tokens.length - 3];

  // If last token is a word, check what comes before it
  if (last.type === "word") {
    if (prev?.type === "op") {
      // field = |word  -> completing value
      return {
        kind: "value",
        partial: last.value,
        field: prevPrev?.value,
        op: prev.value,
      };
    }
    // |word -> completing field
    return { kind: "field", partial: last.value };
  }

  // If last token is an operator, we're starting a value
  if (last.type === "op") {
    return {
      kind: "value",
      partial: "",
      field: prev?.value,
      op: last.value,
    };
  }

  // If last token is a quoted value
  if (last.type === "value") {
    return {
      kind: "value",
      partial: last.value,
      field: prevPrev?.value,
      op: prev?.value,
    };
  }

  // After opening paren, keyword, or closing paren -> new field
  if (
    (last.type === "paren" && last.value === "(") ||
    last.type === "keyword" ||
    (last.type === "paren" && last.value === ")")
  ) {
    return { kind: "field", partial: "" };
  }

  return { kind: "field", partial: "" };
}

/**
 * Tokenize the inner content of where:(...) into structured tokens.
 */
function tokenizeWhereInner(s: string): Token[] {
  const tokens: Token[] = [];
  const wordChar = /[^\s()"=<>!]/;
  let i = 0;

  while (i < s.length) {
    // Skip whitespace
    while (i < s.length && /\s/.test(s[i])) {
      i++;
    }
    if (i >= s.length) break;

    // Parentheses
    if (s[i] === "(" || s[i] === ")") {
      tokens.push({ type: "paren", value: s[i] });
      i++;
      continue;
    }

    // Keywords: 'or' (2 chars)
    if (
      s.length - i >= 2 &&
      /^or$/i.test(s.slice(i, i + 2)) &&
      (i + 2 >= s.length || !wordChar.test(s[i + 2]))
    ) {
      tokens.push({ type: "keyword", value: s.slice(i, i + 2) });
      i += 2;
      continue;
    }

    // Keywords: 'and' (3 chars)
    if (
      s.length - i >= 3 &&
      /^and$/i.test(s.slice(i, i + 3)) &&
      (i + 3 >= s.length || !wordChar.test(s[i + 3]))
    ) {
      tokens.push({ type: "keyword", value: s.slice(i, i + 3) });
      i += 3;
      continue;
    }

    // Operators (check longer ones first)
    let opFound: string | null = null;
    for (const op of WHERE_OPS) {
      if (s.slice(i, i + op.length) === op) {
        opFound = op;
        break;
      }
    }
    if (opFound) {
      tokens.push({ type: "op", value: opFound });
      i += opFound.length;
      continue;
    }

    // Quoted strings
    if (s[i] === '"') {
      let value = "";
      i++; // Skip opening quote
      while (i < s.length) {
        if (s[i] === "\\") {
          // Escape sequence
          i++;
          if (i < s.length) {
            value += s[i];
            i++;
          }
          continue;
        }
        if (s[i] === '"') {
          i++; // Skip closing quote
          break;
        }
        value += s[i];
        i++;
      }
      tokens.push({ type: "value", value });
      continue;
    }

    // Unquoted words
    const start = i;
    while (i < s.length && wordChar.test(s[i])) i++;
    const word = s.slice(start, i);
    if (word) {
      const tokenType = /^(and|or)$/i.test(word) ? "keyword" : "word";
      tokens.push({ type: tokenType, value: word });
    }
  }

  return tokens;
}

/**
 * Get the cursor context: what the user is typing and in which part of the query.
 */
export function getContext(query: string, cursor: number): CursorContext {
  const safeCursor = Math.max(0, Math.min(cursor, query.length));
  const { segment } = getSegmentAtCursor(query, safeCursor);
  const entityValue = getEntityValueFromQuery(query);
  const usedKeys = getTopLevelKeysUsed(query);

  if (!segment) {
    return { kind: "top-level", partial: "", usedKeys };
  }

  const colonIndex = segment.indexOf(":");

  // No colon: might be typing a key or just typed ':'
  if (colonIndex === -1) {
    const trimmedSegment = segment.trim().toLowerCase();
    const justTypedColon = query[safeCursor - 1] === ":";

    if (justTypedColon) {
      if (trimmedSegment === "entity")
        return { kind: "entity-value", partial: "" };
      if (trimmedSegment === "limit")
        return { kind: "limit-value", partial: "" };
      if (trimmedSegment === "order") {
        return { kind: "order-value", partial: "", entityValue };
      }
      if (trimmedSegment === "include") {
        return { kind: "include-value", partial: "", entityValue };
      }
    }

    if (trimmedSegment === "where" && query[safeCursor - 1] === "(") {
      return { kind: "where-field", partial: "", entityValue };
    }

    return { kind: "top-level", partial: segment.trim(), usedKeys };
  }

  // Parse key:value
  const key = segment.slice(0, colonIndex).trim().toLowerCase();
  const value = segment.slice(colonIndex + 1);

  switch (key) {
    case "entity":
      return { kind: "entity-value", partial: value };

    case "limit":
      return { kind: "limit-value", partial: value.trim() };

    case "order": {
      // Value is comma-separated terms (field or "field dir"); current partial = last token of last term
      const afterLastComma = value.includes(",")
        ? value.slice(value.lastIndexOf(",") + 1)
        : value;
      // Trailing space means we're completing direction (asc/desc), so partial is ""
      const partial =
        afterLastComma.endsWith(" ") || afterLastComma.trim() === ""
          ? ""
          : (() => {
              const trimmed = afterLastComma.trimEnd();
              const lastSpace = trimmed.lastIndexOf(" ");
              return lastSpace === -1 ? trimmed : trimmed.slice(lastSpace + 1);
            })();
      // Only suggest asc/desc when we're after a field name (e.g. "order:name " or "order:created_at ")
      const afterField =
        afterLastComma.trimEnd().length > 0 && afterLastComma.endsWith(" ");
      return { kind: "order-value", partial, entityValue, afterField };
    }

    case "include": {
      // Handle comma-separated relations
      const afterLastComma = value.includes(",")
        ? value.slice(value.lastIndexOf(",") + 1).trim()
        : value.trim();
      return { kind: "include-value", partial: afterLastComma, entityValue };
    }

    case "where": {
      let inner = value.trim().startsWith("(")
        ? value.trim().slice(1)
        : value.trim();
      // If segment includes the closing paren of where:(...), strip it so we parse the value position
      if (inner.endsWith(")")) {
        let balance = 0;
        for (const c of inner) {
          if (c === "(") balance++;
          else if (c === ")") balance--;
        }
        if (balance === -1) inner = inner.slice(0, -1).trim();
      }
      const parsed = parseWhereInner(inner);

      if (parsed.kind === "field") {
        return { kind: "where-field", partial: parsed.partial, entityValue };
      }

      return {
        kind: "where-value",
        partial: parsed.partial,
        field: parsed.field ?? "",
        op: parsed.op ?? "=",
        entityValue,
      };
    }

    default:
      return { kind: "unknown", partial: segment };
  }
}

/** One suggestion: text to insert (and optional display label). */
export interface Suggestion {
  label: string;
  insertText: string;
  /** When false, insert at cursor without replacing the partial (e.g. operator after field). Default true. */
  replacePartial?: boolean;
  /** When replacePartial is true, number of characters before the cursor to replace with insertText. */
  replaceLength?: number;
}

/**
 * Get suggestions for the given context using the schema.
 */
export function getSuggestions(
  context: CursorContext,
  schema: Schema,
): Suggestion[] {
  const partial = context.partial.toLowerCase();
  const replaceLen = context.partial.length;
  const matchesPartial = (name: string): boolean => {
    return !partial || name.toLowerCase().startsWith(partial);
  };

  const withReplace = (s: Omit<Suggestion, "replaceLength">): Suggestion =>
    s.replacePartial === false
      ? { ...s, replaceLength: 0 }
      : { ...s, replaceLength: replaceLen };

  switch (context.kind) {
    case "top-level": {
      const usedKeys = new Set(context.usedKeys);
      return TOP_LEVEL_KEYS.filter((k) => {
        const keyName = k.replace(":", "").replace("(", "");
        return !usedKeys.has(keyName) && matchesPartial(keyName);
      }).map((k) => withReplace({ label: k, insertText: k }));
    }

    case "entity-value": {
      return schema.entities
        .filter((e) => matchesPartial(e.name))
        .map((e) => withReplace({ label: e.name, insertText: e.name }));
    }

    case "limit-value":
      // Could suggest common limits: 10, 25, 50, 100
      return [];

    case "order-value": {
      const relevantEntities = findRelevantEntities(
        schema,
        context.entityValue,
      );
      const fieldMap = new Map<string, FieldDef>();
      for (const entity of relevantEntities) {
        for (const [fieldName, fieldDef] of Object.entries(
          entity.fields ?? {},
        )) {
          if (matchesPartial(fieldName)) {
            fieldMap.set(fieldName, fieldDef);
          }
        }
      }
      const suggestions: Suggestion[] = Array.from(fieldMap.keys()).map((f) =>
        withReplace({ label: f, insertText: f }),
      );
      // Only suggest asc/desc when we're after a field name (e.g. "order:name ")
      if (context.afterField) {
        for (const dir of ["asc", "desc"]) {
          if (matchesPartial(dir)) {
            suggestions.push(withReplace({ label: dir, insertText: dir }));
          }
        }
      }
      return suggestions;
    }

    case "include-value": {
      const relevantEntities = findRelevantEntities(
        schema,
        context.entityValue,
      );
      const relations = new Set<string>();

      for (const entity of relevantEntities) {
        for (const relation of entity.relations ?? []) {
          if (matchesPartial(relation)) {
            relations.add(relation);
          }
        }
      }

      return Array.from(relations).map((r) =>
        withReplace({ label: r, insertText: r }),
      );
    }

    case "where-field": {
      const relevantEntities = findRelevantEntities(
        schema,
        context.entityValue,
      );
      const fieldMap = new Map<string, FieldDef>();

      for (const entity of relevantEntities) {
        for (const [fieldName, fieldDef] of Object.entries(
          entity.fields ?? {},
        )) {
          if (matchesPartial(fieldName)) {
            fieldMap.set(fieldName, fieldDef);
          }
        }
      }

      const exactFieldMatch = context.partial && fieldMap.has(context.partial);

      // If user has typed an exact field name, suggest only operators (don't re-suggest the field)
      if (exactFieldMatch) {
        return WHERE_OPS.map((op) =>
          withReplace({
            label: op,
            insertText: op,
            replacePartial: false,
          }),
        );
      }

      const suggestions: Suggestion[] = Array.from(fieldMap.keys()).map((f) =>
        withReplace({ label: f, insertText: f }),
      );

      return suggestions;
    }

    case "where-value": {
      const relevantEntities = findRelevantEntities(
        schema,
        context.entityValue,
      );
      const valueSet = new Set<string>();

      for (const entity of relevantEntities) {
        const fieldDef = entity.fields?.[context.field];
        if (fieldDef?.values) {
          for (const value of fieldDef.values) {
            if (matchesPartial(value)) {
              valueSet.add(value);
            }
          }
        }
      }

      return Array.from(valueSet).map((v) =>
        withReplace({ label: v, insertText: v }),
      );
    }

    default:
      return [];
  }
}

/**
 * Find entities relevant to the given entity value (partial or exact match).
 */
function findRelevantEntities(
  schema: Schema,
  entityValue: string,
): EntityDef[] {
  if (!entityValue) return schema.entities;

  const lowerEntityValue = entityValue.toLowerCase();
  return schema.entities.filter(
    (e) =>
      e.name.toLowerCase() === lowerEntityValue ||
      e.name.toLowerCase().startsWith(lowerEntityValue),
  );
}

/**
 * Convenience: get suggestions for query at cursor in one call.
 */
export function getSuggestionsAtCursor(
  query: string,
  cursor: number,
  schema: Schema,
): Suggestion[] {
  const context = getContext(query, cursor);
  return getSuggestions(context, schema);
}
