/**
 * Schema for RQL autocomplete: entities, relations, and optional field metadata for where-clause.
 */

/** Field metadata for where-clause suggestions (optional enum values). */
export interface FieldDef {
  type?: 'string' | 'number' | 'boolean';
  /** Suggested values for this field (e.g. status: active | pending) */
  values?: string[];
}

/** Definition of an entity: name, relations for include:, and fields for where:. */
export interface EntityDef {
  name: string;
  /** Relation names that can be used in include: for this entity */
  relations?: string[];
  /** Field names (and optional type/values) for where: suggestions */
  fields?: Record<string, FieldDef>;
}

/** Unified schema: list of entities with their relations and fields. */
export interface Schema {
  entities: EntityDef[];
}

/** Build a schema from a list of entity definitions (convenience). */
export function defineSchema(entities: EntityDef[]): Schema {
  return { entities };
}

/** Example schema: users with posts/comments, products with reviews/category. */
export const exampleSchema: Schema = defineSchema([
  {
    name: 'user',
    relations: ['posts', 'comments', 'profile'],
    fields: {
      status: { type: 'string', values: ['active', 'pending', 'suspended'] },
      role: { type: 'string', values: ['admin', 'moderator', 'user', 'guest'] },
      age: { type: 'number' },
      verified: { type: 'boolean' },
    },
  },
  {
    name: 'users',
    relations: ['posts', 'comments', 'profile'],
    fields: {
      status: { type: 'string', values: ['active', 'pending', 'suspended'] },
      role: { type: 'string', values: ['admin', 'moderator', 'user', 'guest'] },
      age: { type: 'number' },
      verified: { type: 'boolean' },
    },
  },
  {
    name: 'product',
    relations: ['reviews', 'category'],
    fields: {
      category: { type: 'string', values: ['archived', 'electronics', 'books'] },
      price: { type: 'number' },
      stock: { type: 'number' },
    },
  },
  {
    name: 'products',
    relations: ['reviews', 'category'],
    fields: {
      category: { type: 'string', values: ['archived', 'electronics', 'books'] },
      price: { type: 'number' },
      stock: { type: 'number' },
    },
  },
]);
