import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlainText, ParseError, isValidPlainText, exampleSchema } from '../dist/index.js';

describe('parsePlainText', () => {

  test('entity only', () => {
    assert.deepStrictEqual(parsePlainText('entity:users'), { entity: 'users' });
    assert.deepStrictEqual(parsePlainText('entity:products'), { entity: 'products' });
  });

  test('entity + limit', () => {
    assert.deepStrictEqual(parsePlainText('entity:users limit:10'), {
      entity: 'users',
      limit: 10,
    });
    assert.deepStrictEqual(parsePlainText('entity:users limit:0'), {
      entity: 'users',
      limit: 0,
    });
  });

  test('entity + include', () => {
    assert.deepStrictEqual(parsePlainText('entity:users include:comments,articles'), {
      entity: 'users',
      include: { comments: true, articles: true },
    });
    assert.deepStrictEqual(parsePlainText('entity:products include:reviews,category'), {
      entity: 'products',
      include: { reviews: true, category: true },
    });
  });

  test('entity + order - single term default asc', () => {
    assert.deepStrictEqual(parsePlainText('entity:users order:name'), {
      entity: 'users',
      order: [{ field: 'name', dir: 'asc' }],
    });
    assert.deepStrictEqual(parsePlainText('entity:products order:price'), {
      entity: 'products',
      order: [{ field: 'price', dir: 'asc' }],
    });
  });

  test('order - explicit asc/desc', () => {
    assert.deepStrictEqual(parsePlainText('entity:users order:created_at desc'), {
      entity: 'users',
      order: [{ field: 'created_at', dir: 'desc' }],
    });
    assert.deepStrictEqual(parsePlainText('entity:users order:name asc'), {
      entity: 'users',
      order: [{ field: 'name', dir: 'asc' }],
    });
  });

  test('order - multiple terms', () => {
    assert.deepStrictEqual(parsePlainText('entity:users order:created_at desc,name asc'), {
      entity: 'users',
      order: [
        { field: 'created_at', dir: 'desc' },
        { field: 'name', dir: 'asc' },
      ],
    });
    assert.deepStrictEqual(parsePlainText('entity:products order:price asc,name'), {
      entity: 'products',
      order: [
        { field: 'price', dir: 'asc' },
        { field: 'name', dir: 'asc' },
      ],
    });
  });

  test('order - direction case-insensitive', () => {
    assert.deepStrictEqual(parsePlainText('entity:users order:name ASC'), {
      entity: 'users',
      order: [{ field: 'name', dir: 'asc' }],
    });
    assert.deepStrictEqual(parsePlainText('entity:users order:name DESC'), {
      entity: 'users',
      order: [{ field: 'name', dir: 'desc' }],
    });
  });

  test('order with other clauses', () => {
    assert.deepStrictEqual(
      parsePlainText('entity:products limit:5 order:price asc,name where:(stock>0)'),
      {
        entity: 'products',
        limit: 5,
        order: [
          { field: 'price', dir: 'asc' },
          { field: 'name', dir: 'asc' },
        ],
        where: { field: 'stock', op: '>', value: 0 },
      }
    );
  });

  test('where - single comparison (equality string)', () => {
    assert.deepStrictEqual(parsePlainText('entity:users where:(status=active)'), {
      entity: 'users',
      where: { field: 'status', op: '=', value: 'active' },
    });
    assert.deepStrictEqual(parsePlainText('entity:users where:(role=admin)'), {
      entity: 'users',
      where: { field: 'role', op: '=', value: 'admin' },
    });
  });

  test('where - comparison with explicit operator', () => {
    assert.deepStrictEqual(parsePlainText('entity:users where:(age>=18)'), {
      entity: 'users',
      where: { field: 'age', op: '>=', value: 18 },
    });
    assert.deepStrictEqual(parsePlainText('entity:products where:(price<100)'), {
      entity: 'products',
      where: { field: 'price', op: '<', value: 100 },
    });
    assert.deepStrictEqual(parsePlainText('entity:products where:(stock>0)'), {
      entity: 'products',
      where: { field: 'stock', op: '>', value: 0 },
    });
    assert.deepStrictEqual(parsePlainText('entity:users where:(role!=guest)'), {
      entity: 'users',
      where: { field: 'role', op: '!=', value: 'guest' },
    });
    assert.deepStrictEqual(parsePlainText('entity:items where:(score<=3.14)'), {
      entity: 'items',
      where: { field: 'score', op: '<=', value: 3.14 },
    });
  });

  test('where - boolean value', () => {
    assert.deepStrictEqual(parsePlainText('entity:users where:(verified=true)'), {
      entity: 'users',
      where: { field: 'verified', op: '=', value: true },
    });
    assert.deepStrictEqual(parsePlainText('entity:users where:(active=false)'), {
      entity: 'users',
      where: { field: 'active', op: '=', value: false },
    });
  });

  test('where - AND (space-separated)', () => {
    assert.deepStrictEqual(parsePlainText('entity:users where:(status=active age>=18)'), {
      entity: 'users',
      where: {
        and: [
          { field: 'status', op: '=', value: 'active' },
          { field: 'age', op: '>=', value: 18 },
        ],
      },
    });
    assert.deepStrictEqual(parsePlainText('entity:products where:(price<100 stock>0 category!=archived)'), {
      entity: 'products',
      where: {
        and: [
          { field: 'price', op: '<', value: 100 },
          { field: 'stock', op: '>', value: 0 },
          { field: 'category', op: '!=', value: 'archived' },
        ],
      },
    });
  });

  test('where - OR', () => {
    assert.deepStrictEqual(parsePlainText('entity:users where:(role=admin OR role=moderator)'), {
      entity: 'users',
      where: {
        or: [
          { field: 'role', op: '=', value: 'admin' },
          { field: 'role', op: '=', value: 'moderator' },
        ],
      },
    });
    assert.deepStrictEqual(parsePlainText('entity:users where:(status=active OR status=pending)'), {
      entity: 'users',
      where: {
        or: [
          { field: 'status', op: '=', value: 'active' },
          { field: 'status', op: '=', value: 'pending' },
        ],
      },
    });
  });

  test('where - nested (OR of comparison and AND group)', () => {
    assert.deepStrictEqual(
      parsePlainText('entity:users limit:10 where:((role=admin) OR (age>=18 AND verified=true))'),
      {
        entity: 'users',
        limit: 10,
        where: {
          or: [
            { field: 'role', op: '=', value: 'admin' },
            {
              and: [
                { field: 'age', op: '>=', value: 18 },
                { field: 'verified', op: '=', value: true },
              ],
            },
          ],
        },
      }
    );
  });

  test('where - quoted string value', () => {
    assert.deepStrictEqual(parsePlainText('entity:users where:(name="Alice")'), {
      entity: 'users',
      where: { field: 'name', op: '=', value: 'Alice' },
    });
    assert.deepStrictEqual(parsePlainText('entity:users where:(name="Alice Smith")'), {
      entity: 'users',
      where: { field: 'name', op: '=', value: 'Alice Smith' },
    });
  });

  test('where - quoted value forces string (number-looking and boolean-looking)', () => {
    assert.deepStrictEqual(parsePlainText('entity:items where:(id="18")'), {
      entity: 'items',
      where: { field: 'id', op: '=', value: '18' },
    });
    assert.deepStrictEqual(parsePlainText('entity:items where:(flag="true")'), {
      entity: 'items',
      where: { field: 'flag', op: '=', value: 'true' },
    });
  });

  test('where - escaped quotes in quoted value', () => {
    assert.deepStrictEqual(parsePlainText('entity:posts where:(title="Hello \\"World\\"")'), {
      entity: 'posts',
      where: { field: 'title', op: '=', value: 'Hello "World"' },
    });
  });

  test('full example from spec - products with and filter', () => {
    const input = 'entity:products limit:20 include:reviews,category where:(price<100 stock>0 category!=archived)';
    assert.deepStrictEqual(parsePlainText(input), {
      entity: 'products',
      limit: 20,
      include: { reviews: true, category: true },
      where: {
        and: [
          { field: 'price', op: '<', value: 100 },
          { field: 'stock', op: '>', value: 0 },
          { field: 'category', op: '!=', value: 'archived' },
        ],
      },
    });
  });

  test('full example from spec - users with or and nested and', () => {
    const input = 'entity:users limit:10 where:((role=admin) OR (age>=18 AND verified=true))';
    assert.deepStrictEqual(parsePlainText(input), {
      entity: 'users',
      limit: 10,
      where: {
        or: [
          { field: 'role', op: '=', value: 'admin' },
          {
            and: [
              { field: 'age', op: '>=', value: 18 },
              { field: 'verified', op: '=', value: true },
            ],
          },
        ],
      },
    });
  });

  test('clause order is irrelevant', () => {
    const a = parsePlainText('entity:users limit:5 where:(x=1)');
    const b = parsePlainText('limit:5 entity:users where:(x=1)');
    const c = parsePlainText('where:(x=1) entity:users limit:5');
    const expected = { entity: 'users', limit: 5, where: { field: 'x', op: '=', value: 1 } };
    assert.deepStrictEqual(a, expected);
    assert.deepStrictEqual(b, expected);
    assert.deepStrictEqual(c, expected);
  });

  test('clause order is irrelevant (with order)', () => {
    const expected = {
      entity: 'users',
      limit: 5,
      order: [{ field: 'name', dir: 'asc' }],
      where: { field: 'x', op: '=', value: 1 },
    };
    assert.deepStrictEqual(parsePlainText('entity:users limit:5 order:name where:(x=1)'), expected);
    assert.deepStrictEqual(parsePlainText('order:name entity:users limit:5 where:(x=1)'), expected);
  });

  test('empty or whitespace input', () => {
    assert.deepStrictEqual(parsePlainText(''), {});
    assert.deepStrictEqual(parsePlainText('   '), {});
  });

  test('OR case-insensitive', () => {
    assert.deepStrictEqual(parsePlainText('entity:users where:(a=1 or b=2)'), {
      entity: 'users',
      where: {
        or: [
          { field: 'a', op: '=', value: 1 },
          { field: 'b', op: '=', value: 2 },
        ],
      },
    });
  });

  test('precedence: AND binds tighter than OR', () => {
    assert.deepStrictEqual(parsePlainText('entity:users where:(a=1 OR b=2 AND c=3)'), {
      entity: 'users',
      where: {
        or: [
          { field: 'a', op: '=', value: 1 },
          {
            and: [
              { field: 'b', op: '=', value: 2 },
              { field: 'c', op: '=', value: 3 },
            ],
          },
        ],
      },
    });
  });

  test('explicit AND keyword', () => {
    assert.deepStrictEqual(parsePlainText('entity:users where:(age>=18 AND verified=true)'), {
      entity: 'users',
      where: {
        and: [
          { field: 'age', op: '>=', value: 18 },
          { field: 'verified', op: '=', value: true },
        ],
      },
    });
  });

  // --- Fuzzing / invalid input ---

  test('duplicate entity throws', () => {
    assert.throws(() => parsePlainText('entity:users entity:posts'), ParseError);
    assert.throws(() => parsePlainText('entity:users limit:5 entity:posts'), ParseError);
    assert.throws(
      () => parsePlainText('entity:a entity:b'),
      (err) => err.message === 'Duplicate top-level key: entity'
    );
  });

  test('duplicate limit throws', () => {
    assert.throws(() => parsePlainText('entity:users limit:5 limit:10'), ParseError);
    assert.throws(
      () => parsePlainText('entity:users limit:5 limit:10'),
      (err) => err.message === 'Duplicate top-level key: limit'
    );
  });

  test('duplicate where throws', () => {
    assert.throws(() => parsePlainText('entity:users where:(a=1) where:(b=2)'), ParseError);
    assert.throws(
      () => parsePlainText('entity:users where:(a=1) where:(b=2)'),
      (err) => err.message === 'Duplicate top-level key: where'
    );
  });

  test('duplicate include throws', () => {
    assert.throws(() => parsePlainText('entity:users include:a include:b'), ParseError);
    assert.throws(
      () => parsePlainText('entity:users include:a include:b'),
      (err) => err.message === 'Duplicate top-level key: include'
    );
  });

  test('duplicate order throws', () => {
    assert.throws(() => parsePlainText('entity:users order:name order:created_at desc'), ParseError);
    assert.throws(
      () => parsePlainText('entity:users order:name order:created_at desc'),
      (err) => err.message === 'Duplicate top-level key: order'
    );
  });

  test('invalid limit throws', () => {
    assert.throws(() => parsePlainText('entity:users limit:-1'), ParseError);
    assert.throws(() => parsePlainText('entity:users limit:abc'), ParseError);
    assert.throws(() => parsePlainText('entity:users limit:1.5'), ParseError);
    assert.throws(() => parsePlainText('entity:users limit:'), ParseError);
    assert.throws(
      () => parsePlainText('entity:users limit:-1'),
      (err) => err.message === 'limit must be non-negative'
    );
    assert.throws(
      () => parsePlainText('entity:users limit:xyz'),
      (err) => err.message === 'limit must be a valid integer'
    );
  });

  test('empty entity throws', () => {
    assert.throws(() => parsePlainText('entity:'), ParseError);
    assert.throws(
      () => parsePlainText('entity: '),
      (err) => err.message === 'entity value must be non-empty'
    );
  });

  test('empty or invalid where throws', () => {
    assert.throws(() => parsePlainText('entity:users where:()'), ParseError);
    assert.throws(
      () => parsePlainText('entity:users where:()'),
      (err) => err.message === 'Empty where clause'
    );
  });

  test('incomplete comparison in where throws', () => {
    assert.throws(() => parsePlainText('entity:users where:(x=)'), ParseError);
    assert.throws(() => parsePlainText('entity:users where:(status=)'), ParseError);
    assert.throws(
      () => parsePlainText('entity:users where:(x=)'),
      (err) => err.message === 'Incomplete comparison in where clause'
    );
  });

  test('unbalanced where parentheses throws', () => {
    assert.throws(() => parsePlainText('entity:users where:(x=1'), ParseError);
    assert.throws(() => parsePlainText('entity:users where:(x=1 AND y=2'), ParseError);
  });

  test('invalid where: OR with no left side throws', () => {
    assert.throws(() => parsePlainText('entity:users where:(OR a=1)'), ParseError);
    assert.throws(
      () => parsePlainText('entity:users where:(OR a=1)'),
      (err) => err.message === 'Invalid where: OR with no left side'
    );
  });

  test('invalid where: OR with no right side throws', () => {
    assert.throws(() => parsePlainText('entity:users where:(a=1 OR)'), ParseError);
    assert.throws(
      () => parsePlainText('entity:users where:(a=1 OR)'),
      (err) => err.message === 'Invalid where: OR with no right side'
    );
  });

  test('invalid where: AND with no right side throws', () => {
    assert.throws(() => parsePlainText('entity:users where:(a=1 AND)'), ParseError);
    assert.throws(
      () => parsePlainText('entity:users where:(a=1 AND)'),
      (err) => err.message === 'Invalid where: AND with no right side'
    );
  });

  test('non-integer limit (trailing junk) throws', () => {
    assert.throws(() => parsePlainText('entity:users limit:10x'), ParseError);
    assert.throws(
      () => parsePlainText('entity:users limit:10x'),
      (err) => err.message === 'limit must be an integer without decimals'
    );
  });

  test('unknown top-level key throws', () => {
    assert.throws(() => parsePlainText('user:foo'), ParseError);
    assert.throws(
      () => parsePlainText('user:foo'),
      (err) => err.message.includes('Unknown top-level key') && err.message.includes('user')
    );
    assert.throws(() => parsePlainText('entity:users sort:name'), ParseError);
    assert.throws(
      () => parsePlainText('entity:users sort:name'),
      (err) => err.message.includes('sort')
    );
  });

  test('empty order value throws', () => {
    assert.throws(() => parsePlainText('entity:users order:'), ParseError);
    assert.throws(
      () => parsePlainText('entity:users order:'),
      (err) => err.message === 'order value must be non-empty'
    );
  });

  test('order with only direction (asc/desc) throws', () => {
    assert.throws(() => parsePlainText('entity:product order:asc'), ParseError);
    assert.throws(() => parsePlainText('entity:users order:desc'), ParseError);
    assert.throws(
      () => parsePlainText('entity:product order:asc'),
      (err) => err.message.includes('Invalid order term') && err.message.includes('field name')
    );
  });

  test('clause without colon (bare word) throws', () => {
    assert.throws(() => parsePlainText('foo'), ParseError);
    assert.throws(
      () => parsePlainText('foo'),
      (err) => err.message.includes('Invalid clause') && err.message.includes('foo')
    );
    assert.throws(() => parsePlainText('entity'), ParseError);
  });

  // --- Validator ---

  test('isValidPlainText returns true for valid strings', () => {
    assert.equal(isValidPlainText('entity:users'), true);
    assert.equal(isValidPlainText('entity:users limit:10'), true);
    assert.equal(isValidPlainText('entity:users where:(status=active)'), true);
    assert.equal(isValidPlainText('entity:users order:name'), true);
    assert.equal(isValidPlainText('entity:products limit:5 order:price asc,name where:(stock>0)'), true);
    assert.equal(isValidPlainText('entity:products limit:20 include:reviews where:(price<100)'), true);
    assert.equal(isValidPlainText(''), true);
    assert.equal(isValidPlainText('   '), true);
  });

  test('isValidPlainText returns false for invalid strings', () => {
    assert.equal(isValidPlainText('entity:users entity:posts'), false);
    assert.equal(isValidPlainText('entity:users limit:5 limit:10'), false);
    assert.equal(isValidPlainText('entity:users where:(a=1) where:(b=2)'), false);
    assert.equal(isValidPlainText('entity:users limit:-1'), false);
    assert.equal(isValidPlainText('entity:users limit:abc'), false);
    assert.equal(isValidPlainText('entity:'), false);
    assert.equal(isValidPlainText('entity:users where:()'), false);
    assert.equal(isValidPlainText('entity:users where:(x=)'), false);
    assert.equal(isValidPlainText('entity:users where:(x=1'), false);
    assert.equal(isValidPlainText('entity:users where:(OR a=1)'), false);
    assert.equal(isValidPlainText('user:foo'), false);
    assert.equal(isValidPlainText('entity:users sort:name'), false);
    assert.equal(isValidPlainText('entity:users order:'), false);
    assert.equal(isValidPlainText('foo'), false);
    assert.equal(isValidPlainText('entity'), false);
  });

  test('parsePlainText with schema - valid entity passes', () => {
    assert.deepStrictEqual(parsePlainText('entity:users limit:5', exampleSchema), {
      entity: 'users',
      limit: 5,
    });
    assert.deepStrictEqual(parsePlainText('entity:product include:reviews', exampleSchema), {
      entity: 'product',
      include: { reviews: true },
    });
  });

  test('parsePlainText with schema - unknown entity throws', () => {
    assert.throws(() => parsePlainText('entity:unknown_entity', exampleSchema), ParseError);
    assert.throws(
      () => parsePlainText('entity:unknown_entity', exampleSchema),
      (err) => err.message.includes('Unknown entity') && err.message.includes('unknown_entity')
    );
  });

  test('parsePlainText with schema - unknown relation throws', () => {
    assert.throws(() => parsePlainText('entity:users include:invalid_relation', exampleSchema), ParseError);
    assert.throws(
      () => parsePlainText('entity:users include:invalid_relation', exampleSchema),
      (err) => err.message.includes('Unknown relation') && err.message.includes('invalid_relation')
    );
  });

  test('parsePlainText with schema - unknown where field throws', () => {
    assert.throws(() => parsePlainText('entity:users where:(unknown_field=1)', exampleSchema), ParseError);
    assert.throws(
      () => parsePlainText('entity:users where:(unknown_field=1)', exampleSchema),
      (err) => err.message.includes('Unknown field') && err.message.includes('unknown_field')
    );
  });

  test('parsePlainText with schema - valid relation and fields pass', () => {
    assert.doesNotThrow(() => parsePlainText('entity:users include:posts,comments where:(status=active)', exampleSchema));
  });

  test('isValidPlainText with schema - false for schema-invalid query', () => {
    assert.equal(isValidPlainText('entity:users', exampleSchema), true);
    assert.equal(isValidPlainText('entity:nonexistent', exampleSchema), false);
    assert.equal(isValidPlainText('entity:users include:badrel', exampleSchema), false);
    assert.equal(isValidPlainText('entity:users where:(badfield=1)', exampleSchema), false);
  });

});
