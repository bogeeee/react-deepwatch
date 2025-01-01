import {it, expect, test, beforeEach,describe, vitest, vi} from 'vitest'
import _ from "underscore"
import {normalizeList, normalizeLists, preserve} from "./preserve";
import clone from "clone";
import exp from "constants";
import {WatchedGraph} from "./watchedGraph";
import {enhanceWithWriteTracker} from "./globalWriteTracking";

beforeEach(() => {

});


function expectSameInstance<T>(oldObj: T, newObj: T) {
    expect(oldObj === newObj).toBeTruthy();
}

function cloneObj<T>(obj: T):T {
    return clone(obj, true, Number.POSITIVE_INFINITY, undefined, true);
}

function preserveAndCheckEquality<T>(oldObj: unknown, newObj: T): T {
    const newCloned = cloneObj(newObj);
    expect(newCloned).toStrictEqual(newObj);
    const expectedResultStructure = cloneObj(newObj);

    const preserved = preserve(oldObj, newObj);
    expectSameInstance(oldObj, preserved);
    expect(_.isEqual(preserved, expectedResultStructure)).toBeTruthy(); // Note: use underscore instead of vitest here, because vitest's comparer method somehow fails with enhanced objects
    return preserved as T;
}

describe('Preserve', () => {
    for (const mode of [{
        name: "Not enhanced", proxyOrEnhance<T extends object>(o: T) {
            return o
        }
    },
    /*
    // Feature not used currently
        {
        name: "ProxiedGraph", proxyOrEnhance<T extends object>(o: T) {
            return new WatchedGraph().getProxyFor(o)
        }
    },
    */
    {
        name: "Direct enhancement", proxyOrEnhance<T extends object>(o: T) {
            enhanceWithWriteTracker(o);
            return o;
        }
    }]) {

        test(`${mode.name}: Simple obj`, () => {
            const obj = mode.proxyOrEnhance({});
            expectSameInstance(obj, preserve(obj, {}));
        })

        test(`${mode.name}: Already same instance`, () => {
            const obj = mode.proxyOrEnhance({});
            expectSameInstance(obj, preserve(obj, obj));
        })

        test(`${mode.name}: Take over props`, () => {
            const old = mode.proxyOrEnhance({a: 1, b: "str"});
            const preserved = preserveAndCheckEquality(old, {a: 2, b: "str", c: 3});
            expect(_.isEqual(preserved, {a: 2, b: "str", c: 3})).toBeTruthy();
        })

        test(`${mode.name}: old props should be deleted`, () => {
            const old = mode.proxyOrEnhance({a: 1, b: "old"});
            const preserved = preserveAndCheckEquality(old, {a: 2, c: 3});
            expect(_.isEqual(preserved, {a: 2, c: 3})).toBeTruthy();
        })

        test(`${mode.name}: child objects`, () => {
            let b = mode.proxyOrEnhance({bProp: 2});
            const old = mode.proxyOrEnhance({a: 1, b: b});
            const preserved = preserveAndCheckEquality(old, {a: 2, b: {pProp: 3, x: "y"}, c: 3});
            expectSameInstance(b as any, preserved.b);
        })

        //TODO: regard mode
        test("Primitive Arrays", () => {
            const old = ["a", "b", "c"];
            const preserved = preserveAndCheckEquality(old, ["a", "b", "d"]);
        })

        //TODO: regard mode
        test("Mixed Arrays, no or invalid keys", () => {
            let expectComplain = /.*(key.*id)|(id\+key).*/;  // Should complain about keys or ids
            expect(() => preserveAndCheckEquality(["a", {bProp: 2}, "c"], ["a", {bProp: 3}, "d"])).toThrow(expectComplain);
            expect(() => preserveAndCheckEquality(["a", {bProp: 2}, "c"], ["a", {
                bProp: 3,
                id: 1
            }, "d"])).toThrow(expectComplain);
            expect(() => preserveAndCheckEquality(["a", {
                bProp: 2,
                id: 1
            }, "c"], ["a", {bProp: 3}, "d"])).toThrow(expectComplain);
            expect(() => preserveAndCheckEquality(["a", {
                bProp: 2,
                key: 1
            }, "c"], ["a", {bProp: 3}, "d"])).toThrow("consistent");
            expect(() => preserveAndCheckEquality(["a", {bProp: 2}, "c"], ["a", {
                bProp: 3,
                key: 1
            }, "d"])).toThrow(expectComplain);
            expect(() => preserveAndCheckEquality(["a", {bProp: 2, id: 1}, "c"], ["a", {
                bProp: 3,
                key: 1
            }, "d"])).toThrow(expectComplain);
            expect(() => preserveAndCheckEquality(["a", {bProp: 2, key: 1}, "c"], ["a", {
                bProp: 3,
                id: 1
            }, "d"])).toThrow(expectComplain);
        })

        //TODO: regard mode
        test("Mixed Arrays, with keys", () => {
            let b = {bProp: 2, id: 1};
            const old = ["a", b, "c"];
            {
                let preserved = preserveAndCheckEquality(old, ["a", {bProp: 3, id: 1}, "d"]);
                expectSameInstance(b as any, preserved[1]);
            }

            // Different index:
            {
                let preserved = preserveAndCheckEquality(old, ["a", "x", {bProp: 3, id: 1}]);
                expectSameInstance(b as any, preserved[2]);
            }

            // Twice:
            {
                let preserved = preserveAndCheckEquality(old, normalizeList(["a", {bProp: 3, id: 1}, {
                    bProp: 3,
                    id: 1
                }]));
                expectSameInstance(b as any, preserved[1]);
                expectSameInstance(b as any, preserved[2]);
            }

            // Twice:
            {
                let preserved = preserveAndCheckEquality(old, normalizeList([{x: "y", id: 2}, {
                    bProp: 3,
                    id: 1
                }, "c", {bProp: 3, id: 1}]));
                expectSameInstance(b as any, preserved[1]);
                expectSameInstance(b as any, preserved[3]);
            }
        })

        //TODO: regard mode
        test("Mixed Arrays, with keys and faulty duplicates", () => {
            let b = {bProp: 2, id: 1};
            const old = ["a", b, "c"];

            // Twice with different values :
            {
                expect(() => preserveAndCheckEquality(old, ["a", {bProp: 3, id: 1}, {
                    bProp: 4,
                    id: 1
                }])).toThrow("mistaken");
                expect(() => preserveAndCheckEquality(old, ["a", {bProp: 3, id: 1}, {id: 1}])).toThrow("mistaken");
                expect(() => preserveAndCheckEquality(old, ["a", {id: 1}, {id: 1, otherProp: {}}])).toThrow("mistaken");
            }
        })

        //TODO: regard mode
        test("Mixed Arrays, with keys", () => {
            let b = {bProp: 2, id: 1};
            const old = ["a", b, "c"];
            let preserved = preserveAndCheckEquality(old, ["a", {bProp: 3, id: 1}, "d"]);
            expectSameInstance(b as any, preserved[1]);
        })

        //TODO: regard mode
        test("Different types", () => {
            class A {
            }

            class B extends A {
            }

            class C {
            }

            const types = [{}, new A, new B, new C, new Set, new Map, []]
            for (const i in types) {
                for (const j in types) {
                    if (i === j) { // Same type
                        {
                            const a = cloneObj(types[i]);
                            const b = cloneObj(types[j]);
                            const newCloned = cloneObj(b);
                            const preserved = preserve(a, b);
                            expectSameInstance(preserved, a);
                            expect(preserved).toStrictEqual(newCloned);
                        }
                        continue;
                    }

                    {
                        const a = cloneObj(types[i]);
                        const b = cloneObj(types[j]);

                        const newCloned = cloneObj(b);
                        const preserved = preserve(a, b);
                        expect(preserved === a).toBeFalsy();
                        expectSameInstance(preserved, b);

                        expect(preserved).toStrictEqual(newCloned);
                    }

                    // With keys
                    {
                        const a = cloneObj(types[i]);
                        //@ts-ignore
                        a.id = 1;
                        const b = cloneObj(types[j]);
                        //@ts-ignore
                        b.id = 1

                        let old1 = [a, a];
                        const preserved = preserve(old1, [b, b]);
                        expectSameInstance(preserved, old1);
                        expectSameInstance(preserved[0], b);
                        expectSameInstance(preserved[1], b);
                    }
                }
            }
        })

        //TODO: regard mode
        test(`Class hierarchy should be intact`, () => {
            let called: string = "";

            class A {
                aProp = "a";

                myMethodOnlyA() {
                    return this.aProp
                }

                get propWithGetterOnlyA() {
                    return "a";
                }

                set setterOnlyA(value: string) {
                    if (value !== "v") {
                        throw new Error("invalid value")
                    }
                    called += "a";
                }

                myMethod() {
                    return "a"
                }

                myMethodWithSuper() {
                    return "a"
                }

                get propWithSuperGetter() {
                    return "a";
                }

                set setterWithSuper(value: string) {
                    if (value !== "v") {
                        throw new Error("invalid value")
                    }
                    called += "a";
                }

            }

            class B extends A {
                myMethod() {
                    return "b"
                }

                myMethodWithSuper() {
                    return super.myMethodWithSuper() + "b";
                }

                get propWithGetter() {
                    return "b";
                }

                get propWithSuperGetter() {
                    return super.propWithSuperGetter + "b";
                }

                set setterWithSuper(value: string) {
                    if (value !== "v") {
                        throw new Error("invalid value")
                    }
                    super.setterWithSuper = value;
                    called += "b";
                }

            }

            const b = new B();
            let newB = new B();
            newB.aProp = "new"
            let preserverd = preserveAndCheckEquality(b, newB);
            expect(preserverd.aProp).toEqual("new");

            expect(b.myMethod()).toEqual("b");
            expect(b.myMethodOnlyA()).toEqual("new");
            expect(b.myMethodWithSuper()).toEqual("ab");
            expect(b.propWithGetter).toEqual("b");
            expect(b.propWithGetterOnlyA).toEqual("a");
            expect(b.propWithSuperGetter).toEqual("ab");
            called = "";
            b.setterOnlyA = "v";
            expect(called).toEqual("a");
            called = "";
            b.setterWithSuper = "v";
            expect(called).toEqual("ab");

            expect(b instanceof B).toBeTruthy();
            expect(b instanceof A).toBeTruthy();

        });

        //TODO: regard mode
        test(`Circular references`, () => {
            {
                const old: any = {a: 1};
                let newObj: any = {a: 2};
                newObj.b = newObj;

                const preserved = preserve(old, newObj, {preserveCircular: true});
                expectSameInstance(old, preserved);
                expectSameInstance(preserved.b, preserved);
            }

            {
                const old: any = {a: 1};
                old.b = old;
                let newObj: any = {a: 2};
                newObj.b = newObj;
                const preserved = preserveAndCheckEquality(old, newObj);
                expectSameInstance(preserved.b, preserved);
            }
        });

        //TODO: regard mode
        test(`Arrays with gaps`, () => {
            const makeArray = (value: unknown[]) => {
                let result: unknown[] = [];
                for (const i in value) {
                    if (value[i] !== undefined) {
                        result[i] = value[i];
                    }
                }
                return result
            }

            {
                const old = makeArray(["a", undefined, undefined, "d"]);
                let newObj = makeArray([undefined, undefined, undefined, "d", "e"]);
                const preserved = preserveAndCheckEquality(old, newObj);
                expect(preserved.length).toBe(5);
                expect([...Object.keys(preserved)]).toEqual(["3", "4"]);
            }
        });

        //TODO: regard mode
        test("Sets", () => {
            let oldObj1 = {id: 1, value: "obj1"};
            let oldObj2 = {id: 2, value: "obj2"};
            const oldSet = new Set<any>([null, undefined, true, 1, "x", oldObj1, oldObj2]);
            let newObj1 = {id: 1, value: "newValue1"};
            let reallyNewObject3 = {id: 3, value: "obj3"};
            const newSet = new Set<any>([null, undefined, true, 1, "x", newObj1, reallyNewObject3]);
            let preserved = preserveAndCheckEquality(oldSet, newSet);
            expect(preserved.has(oldObj1)).toBeTruthy();
            expect(preserved.has(newObj1)).toBeFalsy();
            expect(preserved.has(oldObj2)).toBeFalsy();
            expect(preserved.has(reallyNewObject3)).toBeTruthy();
            expect(preserved.has("x")).toBeTruthy();
        })

        //TODO: regard mode
        test("Map", () => {
            let oldObjKey1 = {id: 1, value: "obj1"};
            let oldObjKey2 = {id: 2, value: "obj2"};
            let oldValue1 = {id: 1, value: "obj1"};
            let oldValue2 = {id: 2, value: "obj2"};
            const oldMap = new Map<any, any>([[null, null], [undefined, "x"], [oldObjKey1, "x"], [oldObjKey2, "y"], ["oldValue1", oldValue1], ["oldValue2", oldValue2]]);

            let newObjKey1 = {id: 1, value: "obj1"};
            let reallyNewObjKey3 = {id: 3, value: "obj2xy"};
            let newValue1 = {id: 1, value: "obj1"};
            let reallyNewValue3 = {id: 3, value: "obj2"};
            const newMap = new Map<any, any>([[null, null], [newObjKey1, "xNew"], [reallyNewObjKey3, "y"], ["newValue1", newValue1], ["v", reallyNewValue3], [undefined, "x"], ["x", "y"]]);

            let preserved = preserveAndCheckEquality(oldMap, newMap);
            expect(preserved.has(oldObjKey1)).toBeTruthy();
            expect(preserved.get(oldObjKey1)).toBe("xNew");
            expect(preserved.has(newObjKey1)).toBeFalsy();
            expect(preserved.has(oldObjKey2)).toBeFalsy();
            expect(preserved.has(reallyNewObjKey3)).toBeTruthy();
            expect(preserved.get(reallyNewObjKey3)).toBe("y");
            expect(preserved.get("v") === reallyNewValue3).toBeTruthy();
            expect(preserved.get("x")).toBe("y");
        })

        //TODO: regard mode
        test("Destroy obsolete objects", () => {
            const oldObj = {}
            const newObj = {prop: "x"};
            preserveAndCheckEquality(oldObj, newObj);
            expect(() => read(newObj.prop)).toThrow("obsolete");
        });
    }
});

test("Normalize lists", ()  => {
    const obj = {a: [{id: 1, value: "a"}, "some", {id: 2, value: "b"}, {id: 1, value: "a"}]}
    normalizeLists(obj);
    expect(obj.a[0] === obj.a[3]).toBeTruthy()
    expect(obj.a[0] === obj.a[2]).toBeFalsy()
    expect(() => {normalizeLists([{id: 1, value: "a"}, "some", {id: 1, value: "b"}])}).toThrow("different content");
});

/**
 * Just do something the runtime can't optimize away
 * @param value
 */
function read(value: any) {
    if( ("" + value) == "blaaxyxzzzsdf" ) {
        throw new Error("should never get here")
    }
}