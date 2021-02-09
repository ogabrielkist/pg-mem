import 'mocha';
import 'chai';
import { newDb } from '../db';
import { IMemoryDb } from '../interfaces';
import { assert, expect } from 'chai';

describe('Inserts', () => {

    let db: IMemoryDb;
    let many: (str: string) => any[];
    let none: (str: string) => void;
    function all(table = 'test') {
        return many(`select * from ${table}`);
    }
    beforeEach(() => {
        db = newDb();
        many = db.public.many.bind(db.public);
        none = db.public.none.bind(db.public);
    });

    it('handles on on conflict do nothing', () => {
        none(`create table test(id text primary key);
            insert into test values ('x');`);

        // just check that reinserting does not work
        assert.throws(() => none(`insert into test values ('x');`))

        // however, this should work
        none(`insert into test values ('x') on conflict do nothing;`);

        expect(many('select * from test'))
            .to.deep.equal([{ id: 'x' }]);
    });

    it('handles on on conflict do update single set', () => {
        none(`create table test(id text primary key, val text);
            insert into test values ('x', 'old');`);

        // just check that reinserting does not work
        assert.throws(() => none(`insert into test values ('x');`))

        // however, this should work
        none(`insert into test values ('x') on conflict(id) do update set val='new';`);

        expect(many('select * from test'))
            .to.deep.equal([{ id: 'x', val: 'new' }]);
    });

    it('cannot accept on conflict update without constraint', () => {
        none(`create table test(id text primary key, a text, b text);
            insert into test values ('x', 'oldA', 'oldB');`)
        assert.throws(() => none(`insert into test values ('x') on conflict do update set a='new'`));
    });

    it('cannot accept on conflict update referencing other values without alias', () => {
        none(`create table test(id text primary key, a text, b text);
            insert into test values ('x', 'oldA', 'oldB');`)
        // ambiguous:
        assert.throws(() => none(`insert into test values ('x') on conflict do update set b=a`));
    });

    it('handles referencing other values in update', () => {
        expect(many(`create table test(id text primary key, a text, b text);
                        insert into test values ('x', 'oldA', 'oldB');
                        insert into test values ('x') on conflict(id) do update set b=test.a;
                        select * from test;`))
            .to.deep.equal([{ id: 'x', a: 'oldA', b: 'oldA' }]);
    })


    it('handles implicit conversions on conflict set', () => {
        expect(many(`create table test(id text primary key, val jsonb);
                        insert into test values ('x', '{"old": true}');
                        insert into test values ('x') on conflict(id) do update set val='{"new": true}';
                        select * from test;`))
            .to.deep.equal([{ id: 'x', val: { new: true } }]);
    });

    it('handles referencing excluded values in update', () => {
        expect(many(`create table test(id text primary key, a text, b text);
                        insert into test values ('x', 'oldA', 'oldB');
                        insert into test values ('x', 'newA') on conflict(id) do update set b=EXCLUDED.a;
                        select * from test;`))
            .to.deep.equal([{ id: 'x', a: 'oldA', b: 'newA' }]);
    });

    it('handles on on conflict do update multiple sets', () => {
        expect(many(`create table test(id text primary key, a text, b text);
                insert into test values ('x', 'oldA', 'oldB');
                insert into test values ('x') on conflict(id) do update set a='newA', b='newB';
                select * from test;`))
            .to.deep.equal([{ id: 'x', a: 'newA', b: 'newB' }]);
    });


    it('handles setting with alias on conflict', () => {
        expect(many(`create table test(id text primary key, a text unique, b text);
                        insert into test values ('x', 'oldA', 'oldB');
                        insert into test as t values ('x')
                                on conflict(id) do update set a=t.b;
                        select * from test;`))
            .to.deep.equal([{ id: 'x', a: 'oldB', b: 'oldB' }]);
    });



    it('handles on conflict with muliple columns indices', () => {
        expect(many(`create table test(ka text, kb integer, val text,  primary key (ka, kb));
                        insert into test values ('a', 1, 'oldA');
                        insert into test values ('a', 1, 'whatever')
                            on conflict(ka, kb) do update set val='newA';
                        select * from test;`))
            .to.deep.equal([{ ka: 'a', kb: 1, val: 'newA' }]);
    });

    it('returns the right thing on conflict', () => {
        expect(many(`create table test(ka text, kb integer, val text,  primary key (ka, kb));
                        insert into test values ('a', 1, 'oldA');
                        insert into test values ('a', 1, 'whatever')
                            on conflict do nothing returning val;`))
            .to.deep.equal([{ val: 'oldA' }]);
    });

    it('ensures serials are transactional', () => {
        expect(many(`create table test(id serial primary key, val text);
                        insert into test(val) values ('x');
                        insert into test(val) values ('x');
                        insert into test(val) values ('x');
                        rollback;
                        insert into test(val) values ('x');
                        select id from test`))
            .to.deep.equal([{ id: 1 }]);
    })

    it('[bugfix] allows returning statement', () => {
        expect(many(`CREATE TABLE "user" ("id" SERIAL NOT NULL, "name" text NOT NULL, CONSTRAINT "PK_cace4a159ff9f2512dd42373760" PRIMARY KEY ("id"));
                ALTER TABLE "user" ADD data jsonb;
                INSERT INTO "user"("name", "data") VALUES ('me', '{"tags":["nice"]}') RETURNING "id";`))
            .to.deep.equal([{ id: 1 }])
    })

    it('can override value when generated by default', () => {
        expect(many(`create table test(id int  GENERATED BY DEFAULT AS IDENTITY, val text);
                insert into test(id,val) overriding user value values (42,'val42');
                insert into test(id,val) values (51,'val51');
                insert into test(id,val) overriding system value values (99,'val99');
                select * from test;`))
            .to.deep.equal([
                { id: 1, val: 'val42' },
                { id: 51, val: 'val51' },
                { id: 99, val: 'val99' },
            ]);
    });

    it('sets default when not provided', () => {
        expect(many(`create table test(id text, n int default 0);
                insert into test(id) values ('x');
                select * from test;`))
            .to.deep.equal([
                { id: 'x', n: 0 },
            ]);
    });

    it('sets default when explicitely told so', () => {
        expect(many(`create table test(n int default 0);
            insert into test(n) values (default);
            select * from test;`))
            .to.deep.equal([
                { n: 0 },
            ]);
    });

    it('does not override null values when default 0', () => {
        expect(many(`create table test(n int default 0);
                insert into test(n) values (null);
                select * from test;`))
            .to.deep.equal([
                { n: null },
            ]);
    });



    it('cannot override value when generated always', () => {
        none(`create table test(id int  GENERATED ALWAYS AS IDENTITY, val text);`);
        assert.throws(() => none(`insert into test(id,val) values (42,'val');`), /cannot insert into column "id"/);
        assert.throws(() => none(`insert into test(id,val) overriding user value values (42,'val');`), /cannot insert into column "id"/);
    });


    it('can force override value when generated by default', () => {
        expect(many(`create table test(id int  GENERATED ALWAYS AS IDENTITY, val text);
                insert into test(id,val) overriding system value values (42,'val');
                select * from test;`))
            .to.deep.equal([{
                id: 42,
                val: 'val'
            }]);
    });


    describe('insert into select', () => {
        it('can insert into select', () => {
            expect(many(`create table test(a varchar(4), b int, c jsonb);
                insert into test (select * from (values ('a', 42, '[]'::jsonb) ) as t);
                select * from test;`))
                .to.deep.equal([{ a: 'a', b: 42, c: [] }])
        });

        it('cannot insert into select when not implicitely convertible', () => {
            none(`create table test(a varchar(4), b int, c jsonb);`);
            assert.throws(() => none(`insert into test (select * from (values ('a', 42, '[]') ) as t)`), /column "c" is of type jsonb but expression is of type text/);
        })

        it('checks that insert values has enough columns', () => {
            none(`create table test(a varchar(4), b int, c jsonb);`);
            assert.throws(() => none(`insert into test(a) (select * from (values ('a', 42, '[]') ) as t)`), /INSERT has more expressions than target columns/);
        })

        it('can pick inserted values', () => {
            expect(many(`create table test(a varchar(4), b int, c jsonb);
                    insert into test(c, b) (select * from (values ('[]'::jsonb, 42) ) as t);
                    select * from test;`))
                .to.deep.equal([{ a: null, b: 42, c: [] }])
        })

        it('skips values', () => {
            expect(many(`create table test(a varchar(4), b int, c jsonb);
                    insert into test (select * from (values ('a', 42) ) as t);
                    select * from test;`))
                .to.deep.equal([{ a: 'a', b: 42, c: null }])
        })

        it('preserves null jsonb alues', () => {
            expect(many(`create table test(val jsonb);
                    insert into test (select * from (values ('null'::jsonb) ) as t);
                    select val, val isnull as "isNil", val = 'null'::jsonb as "eqNilJson" from test;`))
                .to.deep.equal([{ val: null, isNil: false, eqNilJson: true }])
        })
    });
});
