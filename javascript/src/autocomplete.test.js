import { describe, it } from "node:test";
import assert from "node:assert";
import {
  getContext,
  getSuggestions,
  getSuggestionsAtCursor,
} from "../dist/autocomplete.js";

const mockSchema = {
  entities: [
    {
      name: "User",
      fields: {
        id: { type: "string" },
        name: { type: "string" },
        status: {
          type: "enum",
          values: ["active", "inactive", "pending"],
        },
        age: { type: "number" },
      },
      relations: ["posts", "comments"],
    },
    {
      name: "Post",
      fields: {
        id: { type: "string" },
        title: { type: "string" },
        published: { type: "boolean", values: ["true", "false"] },
      },
      relations: ["author", "comments"],
    },
    {
      name: "Comment",
      fields: {
        id: { type: "string" },
        content: { type: "string" },
      },
      relations: ["author", "post"],
    },
  ],
};

describe("getContext", () => {
  describe("top-level context", () => {
    it("should recognize empty query as top-level", () => {
      const ctx = getContext("", 0);
      assert.strictEqual(ctx.kind, "top-level");
      assert.strictEqual(ctx.partial, "");
      assert.deepStrictEqual(ctx.usedKeys, []);
    });

    it("should recognize partial key as top-level", () => {
      const ctx = getContext("ent", 3);
      assert.strictEqual(ctx.kind, "top-level");
      assert.strictEqual(ctx.partial, "ent");
    });

    it("should track used keys", () => {
      const ctx = getContext("entity:User limit:10 ", 21);
      assert.strictEqual(ctx.kind, "top-level");
      assert.deepStrictEqual(ctx.usedKeys.sort(), ["entity", "limit"]);
    });

    it("should recognize cursor at end of query", () => {
      const ctx = getContext("entity:User ", 12);
      assert.strictEqual(ctx.kind, "top-level");
      assert.strictEqual(ctx.partial, "");
    });
  });

  describe("entity-value context", () => {
    it("should recognize entity: with empty value", () => {
      const ctx = getContext("entity:", 7);
      assert.strictEqual(ctx.kind, "entity-value");
      assert.strictEqual(ctx.partial, "");
    });

    it("should recognize entity: with partial value", () => {
      const ctx = getContext("entity:Us", 9);
      assert.strictEqual(ctx.kind, "entity-value");
      assert.strictEqual(ctx.partial, "Us");
    });

    it("should recognize entity: with complete value", () => {
      const ctx = getContext("entity:User", 11);
      assert.strictEqual(ctx.kind, "entity-value");
      assert.strictEqual(ctx.partial, "User");
    });
  });

  describe("limit-value context", () => {
    it("should recognize limit: with empty value", () => {
      const ctx = getContext("limit:", 6);
      assert.strictEqual(ctx.kind, "limit-value");
      assert.strictEqual(ctx.partial, "");
    });

    it("should recognize limit: with value", () => {
      const ctx = getContext("limit:10", 8);
      assert.strictEqual(ctx.kind, "limit-value");
      assert.strictEqual(ctx.partial, "10");
    });
  });

  describe("include-value context", () => {
    it("should recognize include: with empty value", () => {
      const ctx = getContext("entity:User include:", 20);
      assert.strictEqual(ctx.kind, "include-value");
      assert.strictEqual(ctx.partial, "");
      assert.strictEqual(ctx.entityValue, "User");
    });

    it("should recognize include: with single value", () => {
      const ctx = getContext("entity:User include:posts", 25);
      assert.strictEqual(ctx.kind, "include-value");
      assert.strictEqual(ctx.partial, "posts");
    });

    it("should recognize include: with comma-separated values", () => {
      const ctx = getContext("entity:User include:posts,com", 29);
      assert.strictEqual(ctx.kind, "include-value");
      assert.strictEqual(ctx.partial, "com");
    });

    it("should handle spaces after commas", () => {
      const ctx = getContext("entity:User include:posts, comm", 31);
      assert.strictEqual(ctx.kind, "include-value");
      assert.strictEqual(ctx.partial, "comm");
    });
  });

  describe("where-field context", () => {
    it("should recognize where:( with empty field", () => {
      const ctx = getContext("entity:User where:(", 19);
      assert.strictEqual(ctx.kind, "where-field");
      assert.strictEqual(ctx.partial, "");
      assert.strictEqual(ctx.entityValue, "User");
    });

    it("should recognize where:( with partial field", () => {
      const ctx = getContext("entity:User where:(nam", 22);
      assert.strictEqual(ctx.kind, "where-field");
      assert.strictEqual(ctx.partial, "nam");
    });

    it("should recognize field after operator completion", () => {
      const ctx = getContext("entity:User where:(name = \"John\" and ", 38);
      assert.strictEqual(ctx.kind, "where-field");
      assert.strictEqual(ctx.partial, "");
    });

    it("should recognize field after closing paren", () => {
      const ctx = getContext("entity:User where:((name = \"John\") ", 35);
      assert.strictEqual(ctx.kind, "where-field");
      assert.strictEqual(ctx.partial, "");
    });
  });

  describe("where-value context", () => {
    it("should recognize value after operator", () => {
      const ctx = getContext("entity:User where:(status = ", 28);
      assert.strictEqual(ctx.kind, "where-value");
      assert.strictEqual(ctx.partial, "");
      assert.strictEqual(ctx.field, "status");
      assert.strictEqual(ctx.op, "=");
    });

    it("should recognize partial value", () => {
      const ctx = getContext("entity:User where:(status = act", 31);
      assert.strictEqual(ctx.kind, "where-value");
      assert.strictEqual(ctx.partial, "act");
      assert.strictEqual(ctx.field, "status");
    });

    it("should handle quoted values", () => {
      const ctx = getContext('entity:User where:(name = "Jo', 29);
      assert.strictEqual(ctx.kind, "where-value");
      assert.strictEqual(ctx.partial, "Jo");
      assert.strictEqual(ctx.field, "name");
    });

    it("should handle different operators", () => {
      const ctx = getContext("entity:User where:(age >= 18", 28);
      assert.strictEqual(ctx.kind, "where-value");
      assert.strictEqual(ctx.partial, "18");
      assert.strictEqual(ctx.op, ">=");
    });
  });

  describe("complex queries", () => {
    it("should handle multi-clause queries", () => {
      const query = "entity:User limit:10 where:(status = active)";
      const ctx = getContext(query, query.length);
      assert.strictEqual(ctx.kind, "where-value");
    });

    it("should handle queries with multiple where conditions", () => {
      const ctx = getContext(
        'entity:User where:(name = "John" and status = ',
        46
      );
      assert.strictEqual(ctx.kind, "where-value");
      assert.strictEqual(ctx.field, "status");
    });

    it("should handle nested parentheses", () => {
      const ctx = getContext("entity:User where:((status = active) or (", 41);
      assert.strictEqual(ctx.kind, "where-field");
    });

    describe("cursor after where block", () => {
      it("should treat text after closing paren as top-level", () => {
        const query = "entity:User where:(status!=active) ";
        const ctx = getContext(query, query.length);
        assert.strictEqual(ctx.kind, "top-level");
        assert.strictEqual(ctx.partial, "");
        assert.ok(ctx.usedKeys.includes("entity"));
        assert.ok(ctx.usedKeys.includes("where"));
      });

      it("should treat partial key after where block as top-level with trimmed partial", () => {
        const query = "entity:User where:(status!=active) l";
        const ctx = getContext(query, query.length);
        assert.strictEqual(ctx.kind, "top-level");
        assert.strictEqual(ctx.partial, "l");
        assert.ok(ctx.usedKeys.includes("entity"));
        assert.ok(ctx.usedKeys.includes("where"));
      });
    });
  });
});

describe("getSuggestions", () => {
  describe("top-level suggestions", () => {
    it("should suggest all keys when none are used", () => {
      const ctx = { kind: "top-level", partial: "", usedKeys: [] };
      const suggestions = getSuggestions(ctx, mockSchema);

      const labels = suggestions.map((s) => s.label);
      assert.ok(labels.includes("entity:"));
      assert.ok(labels.includes("limit:"));
      assert.ok(labels.includes("include:"));
      assert.ok(labels.includes("where:("));
    });

    it("should filter out used keys", () => {
      const ctx = { kind: "top-level", partial: "", usedKeys: ["entity"] };
      const suggestions = getSuggestions(ctx, mockSchema);

      const labels = suggestions.map((s) => s.label);
      assert.ok(!labels.includes("entity:"));
      assert.ok(labels.includes("limit:"));
    });

    it("should filter by partial match", () => {
      const ctx = { kind: "top-level", partial: "ent", usedKeys: [] };
      const suggestions = getSuggestions(ctx, mockSchema);

      assert.strictEqual(suggestions.length, 1);
      assert.strictEqual(suggestions[0].label, "entity:");
    });
  });

  describe("entity-value suggestions", () => {
    it("should suggest all entities", () => {
      const ctx = { kind: "entity-value", partial: "" };
      const suggestions = getSuggestions(ctx, mockSchema);

      const labels = suggestions.map((s) => s.label);
      assert.ok(labels.includes("User"));
      assert.ok(labels.includes("Post"));
      assert.ok(labels.includes("Comment"));
    });

    it("should filter entities by partial match", () => {
      const ctx = { kind: "entity-value", partial: "Po" };
      const suggestions = getSuggestions(ctx, mockSchema);

      assert.strictEqual(suggestions.length, 1);
      assert.strictEqual(suggestions[0].label, "Post");
    });

    it("should be case-insensitive", () => {
      const ctx = { kind: "entity-value", partial: "po" };
      const suggestions = getSuggestions(ctx, mockSchema);

      assert.strictEqual(suggestions.length, 1);
      assert.strictEqual(suggestions[0].label, "Post");
    });
  });

  describe("include-value suggestions", () => {
    it("should suggest relations for entity", () => {
      const ctx = {
        kind: "include-value",
        partial: "",
        entityValue: "User",
      };
      const suggestions = getSuggestions(ctx, mockSchema);

      const labels = suggestions.map((s) => s.label);
      assert.ok(labels.includes("posts"));
      assert.ok(labels.includes("comments"));
    });

    it("should filter relations by partial match", () => {
      const ctx = {
        kind: "include-value",
        partial: "pos",
        entityValue: "User",
      };
      const suggestions = getSuggestions(ctx, mockSchema);

      assert.strictEqual(suggestions.length, 1);
      assert.strictEqual(suggestions[0].label, "posts");
    });

    it("should handle partial entity value", () => {
      const ctx = {
        kind: "include-value",
        partial: "",
        entityValue: "Us",
      };
      const suggestions = getSuggestions(ctx, mockSchema);

      const labels = suggestions.map((s) => s.label);
      assert.ok(labels.includes("posts"));
    });
  });

  describe("where-field suggestions", () => {
    it("should suggest all fields for entity", () => {
      const ctx = {
        kind: "where-field",
        partial: "",
        entityValue: "User",
      };
      const suggestions = getSuggestions(ctx, mockSchema);

      const labels = suggestions.map((s) => s.label);
      assert.ok(labels.includes("id"));
      assert.ok(labels.includes("name"));
      assert.ok(labels.includes("status"));
      assert.ok(labels.includes("age"));
    });

    it("should filter fields by partial match", () => {
      const ctx = {
        kind: "where-field",
        partial: "sta",
        entityValue: "User",
      };
      const suggestions = getSuggestions(ctx, mockSchema);

      assert.strictEqual(suggestions.length, 1);
      assert.strictEqual(suggestions[0].label, "status");
    });

    it("should suggest only operators after exact field match (not the field again)", () => {
      const ctx = {
        kind: "where-field",
        partial: "status",
        entityValue: "User",
      };
      const suggestions = getSuggestions(ctx, mockSchema);

      const labels = suggestions.map((s) => s.label);
      assert.ok(labels.includes("="));
      assert.ok(labels.includes("!="));
      assert.ok(labels.includes(">="));
      assert.ok(!labels.includes("status"), "should not re-suggest field when already typed");
      suggestions.forEach((s) => {
        assert.strictEqual(s.replacePartial, false, "operators should insert after partial");
      });
    });
  });

  describe("where-value suggestions", () => {
    it("should suggest enum values", () => {
      const ctx = {
        kind: "where-value",
        partial: "",
        field: "status",
        op: "=",
        entityValue: "User",
      };
      const suggestions = getSuggestions(ctx, mockSchema);

      const labels = suggestions.map((s) => s.label);
      assert.ok(labels.includes("active"));
      assert.ok(labels.includes("inactive"));
      assert.ok(labels.includes("pending"));
    });

    it("should filter values by partial match", () => {
      const ctx = {
        kind: "where-value",
        partial: "act",
        field: "status",
        op: "=",
        entityValue: "User",
      };
      const suggestions = getSuggestions(ctx, mockSchema);

      assert.strictEqual(suggestions.length, 1);
      assert.strictEqual(suggestions[0].label, "active");
    });

    it("should return empty array for fields without values", () => {
      const ctx = {
        kind: "where-value",
        partial: "",
        field: "name",
        op: "=",
        entityValue: "User",
      };
      const suggestions = getSuggestions(ctx, mockSchema);

      assert.strictEqual(suggestions.length, 0);
    });
  });

  describe("replaceLength", () => {
    it("should set replaceLength to partial length when replacePartial is true (default)", () => {
      const ctx = { kind: "entity-value", partial: "Us" };
      const suggestions = getSuggestions(ctx, mockSchema);

      assert.ok(suggestions.length >= 1);
      suggestions.forEach((s) => {
        assert.strictEqual(s.replaceLength, 2, "replaceLength should match partial length");
      });
    });

    it("should set replaceLength to 0 when replacePartial is false (e.g. operators)", () => {
      const ctx = {
        kind: "where-field",
        partial: "status",
        entityValue: "User",
      };
      const suggestions = getSuggestions(ctx, mockSchema);

      assert.ok(suggestions.length >= 1);
      suggestions.forEach((s) => {
        assert.strictEqual(s.replacePartial, false);
        assert.strictEqual(s.replaceLength, 0);
      });
    });

    it("should set replaceLength to 0 for empty partial", () => {
      const ctx = { kind: "entity-value", partial: "" };
      const suggestions = getSuggestions(ctx, mockSchema);

      assert.ok(suggestions.length >= 1);
      suggestions.forEach((s) => {
        assert.strictEqual(s.replaceLength, 0);
      });
    });
  });
});

describe("getSuggestionsAtCursor", () => {
  it("should combine context and suggestions", () => {
    const query = "entity:";
    const suggestions = getSuggestionsAtCursor(query, 7, mockSchema);

    const labels = suggestions.map((s) => s.label);
    assert.ok(labels.includes("User"));
    assert.ok(labels.includes("Post"));
  });

  it("should work with complex queries", () => {
    const query = "entity:User where:(status = ";
    const suggestions = getSuggestionsAtCursor(query, query.length, mockSchema);

    const labels = suggestions.map((s) => s.label);
    assert.ok(labels.includes("active"));
    assert.ok(labels.includes("inactive"));
  });

  it("should handle cursor in middle of query", () => {
    const query = "entity:User limit:10";
    const suggestions = getSuggestionsAtCursor(query, 9, mockSchema);

    // Cursor is at "entity:Us|er" - should suggest entities
    const labels = suggestions.map((s) => s.label);
    assert.ok(labels.includes("User"));
  });

  it("should suggest top-level keys (e.g. limit:) when typing after where block", () => {
    const query = "entity:User where:(status!=active) l";
    const suggestions = getSuggestionsAtCursor(query, query.length, mockSchema);

    const labels = suggestions.map((s) => s.label);
    assert.ok(labels.includes("limit:"), "should suggest limit: when typing 'l' after where block");
    assert.ok(!labels.includes("status"), "should not suggest where fields after closing paren");
  });

  it("entity:U should suggest only entities beginning with U", () => {
    const suggestions = getSuggestionsAtCursor("entity:U", 8, mockSchema);
    const labels = suggestions.map((s) => s.label);
    assert.strictEqual(suggestions.length, 1);
    assert.strictEqual(labels[0], "User");
  });

  it("entity:User w should suggest only where:( as the only matching top-level key", () => {
    const suggestions = getSuggestionsAtCursor("entity:User w", 13, mockSchema);
    const labels = suggestions.map((s) => s.label);
    assert.strictEqual(suggestions.length, 1);
    assert.strictEqual(labels[0], "where:(");
  });

  it("should include replaceLength on suggestions for client replacement (e.g. entity:Us)", () => {
    const suggestions = getSuggestionsAtCursor("entity:Us", 9, mockSchema);
    assert.strictEqual(suggestions.length, 1);
    assert.strictEqual(suggestions[0].label, "User");
    assert.strictEqual(suggestions[0].replaceLength, 2, "partial 'Us' has length 2");
  });
});

describe("edge cases", () => {
  it("should handle cursor beyond query length", () => {
    const ctx = getContext("entity:User", 100);
    assert.strictEqual(ctx.kind, "entity-value");
  });

  it("should handle negative cursor position", () => {
    const ctx = getContext("entity:User", -5);
    assert.strictEqual(ctx.kind, "top-level");
  });

  it("should handle escaped quotes in where clause", () => {
    const ctx = getContext('entity:User where:(name = "John \\"Doe\\"', 39);
    assert.strictEqual(ctx.kind, "where-value");
  });

  it("should handle unclosed quotes", () => {
    const ctx = getContext('entity:User where:(name = "John', 31);
    assert.strictEqual(ctx.kind, "where-value");
    assert.strictEqual(ctx.partial, "John");
  });

  it("should handle multiple spaces", () => {
    const ctx = getContext("entity:User    where:(", 22);
    assert.strictEqual(ctx.kind, "where-field");
  });

  it("should handle empty schema", () => {
    const emptySchema = { entities: [] };
    const suggestions = getSuggestionsAtCursor("entity:", 7, emptySchema);
    assert.strictEqual(suggestions.length, 0);
  });

  it("should handle entity without fields", () => {
    const minimalSchema = {
      entities: [{ name: "Empty" }],
    };
    const ctx = {
      kind: "where-field",
      partial: "",
      entityValue: "Empty",
    };
    const suggestions = getSuggestions(ctx, minimalSchema);
    assert.strictEqual(suggestions.length, 0);
  });

  it("should handle unknown context kind gracefully", () => {
    const ctx = { kind: "unknown", partial: "test" };
    const suggestions = getSuggestions(ctx, mockSchema);
    assert.strictEqual(suggestions.length, 0);
  });
});
