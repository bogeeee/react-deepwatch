import {it, expect, test, beforeEach,describe, vitest, vi} from 'vitest'
import {
    RecordedArrayValuesRead,
    RecordedPropertyRead,
    RecordedRead,
    recordedReadsArraysAreEqual,
    WatchedGraph
} from "./watchedGraph";
import _ from "underscore"
import {arraysAreEqualsByPredicateFn, isObject, visitReplace} from "./Util";
import {Clazz, ObjKey} from "./common";
import {deleteProperty, enhanceWithWriteTracker} from "./globalWriteTracking";
import {ProxiedGraph} from "./proxiedGraph";
import exp from "constants";
import {fail} from "assert";

beforeEach(() => {

});

function createSampleObjectGraph() {
    return {
        appName: "HelloApp",
        users: [{id: 1, name: "Bob", active: true}, {id: 2, name: "Alice", active: false}],
        nullable: null,
    }
}


describe('ProxiedGraph tests', () => {
    test("Base implementation", () => {
        const sampleGraph = createSampleObjectGraph();
        let watchedGraph = new WatchedGraph();
        const proxy = watchedGraph.getProxyFor(sampleGraph);
        expect(proxy !== sampleGraph).toBeTruthy();
        expect(watchedGraph.getProxyFor(proxy) === proxy).toBeTruthy(); // Should return the proxy again
        expect(proxy.appName).toBe("HelloApp");
        expect(proxy.users === sampleGraph.users).toBe(false);
        expect(proxy.users.length).toBe(2);
    })

    test("Arrays", () => {
        const origArray = ["a", "b", "c"]
        const proxy = new WatchedGraph().getProxyFor(origArray);
        expect(proxy[0]).toBe("a");
        expect(proxy.length).toBe(3);

        const collected = [];
        for(const i of proxy) {
            collected.push(i);
        }
        expect(collected).toEqual(origArray);
    })



    test("Functions. 'this' should be the proxy", () => {
        const origObj = {
            thisIsOrigObj() {
                return this === origObj;
            }
        };
        const proxy = new WatchedGraph().getProxyFor(origObj);
        expect(proxy.thisIsOrigObj()).toBeFalsy();
    })

    test("Property accessors. 'this' should be the proxy", () => {
        const origObj = {
            get thisIsOrigObj() {
                return this === origObj;
            },

            set checkThisShouldNotBeOrigObj(value: string) {
                if(this === origObj) {
                    throw new Error("Assertion check failed");
                }
            }
        };
        const proxy = new WatchedGraph().getProxyFor(origObj);
        expect(proxy.thisIsOrigObj).toBeFalsy();
        proxy.checkThisShouldNotBeOrigObj = "dummy";
    })

    test("Property accessors. 'this' should be the proxy - for subclasses", () => {
        let origObj: any;
        class Base {
            get thisIsOrigObj() {
                return this === origObj;
            }

            set checkThisShouldNotBeOrigObj(value: string) {
                if(this === origObj) {
                    throw new Error("Assertion check failed");
                }
            }
        }
        class Sub extends Base {

        }
        origObj = new Sub();

        const proxy = new WatchedGraph().getProxyFor(origObj);
        expect(proxy.thisIsOrigObj).toBeFalsy();
        proxy.checkThisShouldNotBeOrigObj = "dummy";
    })

    test("Property accessors: 'this' should be the topmost proxy when using 2 layers of proxies", () => {
        const origObj = {
            get thisIsProxy2() {
                return this === proxy2;
            },

            set checkThisShouldBeProxy2(value: string) {
                if(this !== proxy2) {
                    throw new Error("Assertion check failed");
                }
            }
        };
        const proxy1 = new WatchedGraph().getProxyFor(origObj);
        const proxy2 = new WatchedGraph().getProxyFor(proxy1);
        expect(proxy2.thisIsProxy2).toBeTruthy();
        proxy2.checkThisShouldBeProxy2 = "dummy";
    })

    test("Set a property that does not exist", () => {
        const origObj = {} as any;
        const proxy = new WatchedGraph().getProxyFor(origObj);
        const subObj = {};
        proxy.myNewProperty = subObj
        expect(proxy.myNewProperty === subObj).toBeFalsy(); // Should be a proxy of it
        expect(Object.keys(proxy)).toEqual(["myNewProperty"]);
    })


    test("instaceof", () => {
        class MyClass {

        }
        const origObj = new MyClass();
        const proxy = new WatchedGraph().getProxyFor(origObj);
        expect(proxy instanceof MyClass).toBeTruthy();
    });

    test("delete property", () => {
        const origObj = {
            a: "b"
        };
        const proxy = new WatchedGraph().getProxyFor(origObj);
        expect(Reflect.ownKeys(proxy)).toStrictEqual(["a"]);
        //@ts-ignore
        delete proxy.a;
        expect(proxy.a).toBeUndefined();
        expect(Reflect.ownKeys(proxy)).toStrictEqual([]);
    });




    test("Readonly props should not cause an error - fails - skipped", ()=> {
        return; // skip, cause we wont fix this soon

        const orig:{prop: object} = {} as any
        Object.defineProperty(orig, "prop", {
            value: {},
            writable: false
        })

        let watchedGraph = new WatchedGraph();
        const proxy = watchedGraph.getProxyFor(orig);
        expect(proxy.prop).toStrictEqual(orig.prop);
    })

    // TODO: Array, Set and Map's Iterators, keys(), values(), etc. methods must return proxied objects as well
});

describe('ProxiedGraph and direct enhancement tests', () => {
    for (const mode of [{
        name: "ProxiedGraph", proxyOrEnhance<T extends object>(o: T) {
            return new WatchedGraph().getProxyFor(o)
        }
    }, {
        name: "Direct enhancement", proxyOrEnhance<T extends object>(o: T) {
            enhanceWithWriteTracker(o);
            return o;
        }
    }]) {

        test(`${mode.name}: Object.keys`, () => {
            const origObj = {a: "x", arr:["a","b"]};
            const proxy = mode.proxyOrEnhance(origObj);
            expect(Object.keys(proxy)).toEqual(["a", "arr"]);
            expect(Object.keys(proxy.arr)).toEqual(Object.keys(origObj.arr));
        })

        test(`${mode.name}: Non modification`, () => {
            const origObj = {a: "a"};
            const proxy = mode.proxyOrEnhance(origObj);
            proxy.a = "a"; // Should at least not trigger an error
        })

        test(`${mode.name}: Property accessors`, () => {
            const origObj = new class {
                get artificialProprty() {
                    return "some";
                }

                _a = "";

                get a() {
                    return this._a;
                }

                set a(value: string) {
                    this._a = value;
                }

                set setMe(value: string) {
                    this._a = value;
                }
            }

            const proxy = mode.proxyOrEnhance(origObj);

            expect(proxy.a).toEqual("");

            proxy.a = "x"
            expect(proxy.a).toEqual("x");

            proxy.setMe = "y"
            expect(proxy.a).toEqual("y");

            expect(proxy.artificialProprty).toEqual("some");

        })

        test(`${mode.name}: Readonly props from prototypes should not cause an error`, ()=> {
            class A {
                prop!: object
            }
            Object.defineProperty(A.prototype, "prop", {
                value: {},
                writable: false
            })

            const orig = new A();

            const proxy = mode.proxyOrEnhance(orig);
            expect(proxy.prop).toStrictEqual(orig.prop);
        })

        test(`${mode.name}: Class hierarchy should be intact`, ()=> {
            let called: string = "";
            class A {
                myMethodOnlyA() {
                    return "a"
                }
                get propWithGetterOnlyA() {
                    return "a";
                }
                set setterOnlyA(value: string) {
                    if(value !== "v") {
                        throw new Error("invalid value")
                    }
                    called+="a";
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
                    if(value !== "v") {
                        throw new Error("invalid value")
                    }
                    called+="a";
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
                    if(value !== "v") {
                        throw new Error("invalid value")
                    }
                    super.setterWithSuper = value;
                    called+="b";
                }

            }

            const b = mode.proxyOrEnhance(new B());
            expect(b.myMethod()).toEqual("b");
            expect(b.myMethodOnlyA()).toEqual("a");
            expect(b.myMethodWithSuper()).toEqual("ab");
            expect(b.propWithGetter).toEqual("b");
            expect(b.propWithGetterOnlyA).toEqual("a");
            expect(b.propWithSuperGetter).toEqual("ab");
            called="";b.setterOnlyA = "v";expect(called).toEqual("a");
            called="";b.setterWithSuper = "v";expect(called).toEqual("ab");

            expect(b instanceof B).toBeTruthy();
            expect(b instanceof A).toBeTruthy();

        });

        test(`${mode.name}: Writes arrive`, ()=> {
            const orig:any = {a: "x", counter: 0}
            const proxy = mode.proxyOrEnhance(orig);
            expect(proxy.a).toEqual("x");
            proxy.b = "2"
            expect(proxy.b).toEqual("2");
            expect(orig.b).toEqual("2");
            orig.c = "3"
            expect(proxy.c).toEqual("3");

            proxy.counter++;
            proxy.counter++;
            expect(proxy.counter).toEqual(2);
        } )

        /*
        // Not possible with enhancement
        test(`${mode.name}: Prototype should be the same`, () => {
            const orig:any = {a: "x", counter: 0}
            const protoOrig = Object.getPrototypeOf(orig);
            const proxy = mode.proxyOrEnhance(orig);
            expect(protoOrig === Object.getPrototypeOf(proxy)).toBeTruthy();

        });
        */
        test(`${mode.name}: Constructor should be the same`, () => {
            for(const obj of [{}, new Set, new Map, []]) {
                const orig: object = obj
                const constructorOrig = obj.constructor;
                const proxy = mode.proxyOrEnhance(orig);
                expect(constructorOrig === proxy.constructor).toBeTruthy();
            }

        });

    }
});

describe('WatchedGraph tests', () => {
    function readsEqual(reads: RecordedPropertyRead[], expected: { obj: object, key?: ObjKey, value?: unknown, values?: unknown[] }[]) {
        function arraysAreShallowlyEqual(a?: unknown[], b?: unknown[]) {
            if((a === undefined) && (b === undefined)) {
                return true;
            }
            if(a === undefined || b === undefined) {
                return false;
            }
            if(a.length !== b.length) {
                return false;
            }
            for(let i = 0;i<a.length;i++) {
                if(a[i] !== b[i]) { // TODO add option for object instance equality
                    return false;
                }
            }
            return true;
        }

        return arraysAreEqualsByPredicateFn(reads, expected, (propRead, exp) => {
            return propRead.obj === exp.obj && propRead.key === exp.key && propRead.value === exp.value && arraysAreShallowlyEqual((propRead as unknown as RecordedArrayValuesRead).values, exp.values);
        })
    }

    test("onAfterRead", () => {
        const sampleGraph = createSampleObjectGraph();
        let watchedGraph = new WatchedGraph();
        const proxy = watchedGraph.getProxyFor(sampleGraph);
        let reads: RecordedPropertyRead[] = [];
        watchedGraph.onAfterRead(r => reads.push(r as RecordedPropertyRead));

        reads = [];
        expect(proxy.appName).toBeDefined();
        expect(readsEqual(reads, [{obj: sampleGraph, key: "appName", value: "HelloApp"}])).toBeTruthy();

        reads = [];
        expect(proxy.nullable).toBeNull();
        expect(readsEqual(reads, [{obj: sampleGraph, key: "nullable", value: null}])).toBeTruthy();

        reads = [];
        expect(proxy.users[0]).toBeDefined();
        expect(readsEqual(reads, [
            {obj: sampleGraph, key: "users", value: sampleGraph.users},
            {obj: sampleGraph.users, key: "0", value: sampleGraph.users[0]}
        ])).toBeTruthy();
    })

    test("onAfterRead - iterate array", () => {
        const sampleGraph = createSampleObjectGraph();
        let watchedGraph = new WatchedGraph();
        const proxy = watchedGraph.getProxyFor(sampleGraph);
        let reads: RecordedPropertyRead[] = [];
        watchedGraph.onAfterRead(r => reads.push(r as RecordedPropertyRead));

        // Iterate an array
        reads = [];
        proxy.users.forEach(user => expect(user).toBeDefined());
        expect(readsEqual(reads, [
            {obj: sampleGraph, key: "users", value: sampleGraph.users},
            {obj: sampleGraph.users, values: sampleGraph.users},
            {obj: sampleGraph.users, key: "0", value: sampleGraph.users[0]},
            {obj: sampleGraph.users, key: "1", value: sampleGraph.users[1]},
        ])).toBeTruthy();

    });

    test("onAfterRead - whitebox getters", () => {
        const origObj = {
            _prop: true,
            get prop() {
                return this._prop;
            }
        }
        let watchedGraph = new WatchedGraph();
        const proxy = watchedGraph.getProxyFor(origObj);

        // Install listener:
        let reads: RecordedPropertyRead[] = [];
        watchedGraph.onAfterRead(r => reads.push(r as RecordedPropertyRead));

        expect(proxy.prop).toBeDefined();
        expect(readsEqual(reads,[{obj: origObj, key: "_prop", value: true}])).toBeTruthy();
    });

    test("onAfterWrite", () => {
        const sampleGraph = createSampleObjectGraph();
        let watchedGraph = new WatchedGraph();
        const proxy = watchedGraph.getProxyFor(sampleGraph);

        // Install listener:
        let writes: unknown[] = [];
        watchedGraph.onAfterWriteOnProperty(sampleGraph, "appName", () => writes.push("dummy"));

        proxy.appName = "xyz"; proxy.appName = "123";
        expect(writes.length).toEqual(2)

    });

    test("onAfterWrite increase counter with ++", () => {
        const sampleGraph = {counter: 0};
        let watchedGraph = new WatchedGraph();
        const proxy = watchedGraph.getProxyFor(sampleGraph);

        // Install listener:
        let writes: unknown[] = [];
        watchedGraph.onAfterWriteOnProperty(sampleGraph, "counter", () => writes.push("dummy"));

        proxy.counter++;
        expect(writes.length).toEqual(1);

    });

    it("should not fire onChange when value stays the same", ()=> {
        // TODO
    })

    test("isArray should work on a proxy", () => {
        const origObj: any[] = [];
        let watchedGraph = new WatchedGraph();
        const proxy = watchedGraph.getProxyFor(origObj);
        expect(Array.isArray(proxy)).toBeTruthy();
        expect(_.isArray(proxy)).toBeTruthy();
    })

    test("Template", () => {
        const sampleGraph = createSampleObjectGraph();
        let watchedGraph = new WatchedGraph();
        const proxy = watchedGraph.getProxyFor(sampleGraph);
    });
});


describe('WatchedGraph record read and watch it', () => {
    /**
     * Just do something the runtime can't optimize away
     * @param value
     */
    function read(value: any) {
        if( ("" + value) == "blaaxyxzzzsdf" ) {
            throw new Error("should never get here")
        }
    }

    const testRecordedRead_isChanged_alreadyHandled = new Set<(obj: any) => void>();
    function testRecordedRead_isChanged<T extends object>(provideTestSetup: () => {origObj: T, readerFn: (obj: T) => void}) {
        const testSetup = provideTestSetup()

        if(testRecordedRead_isChanged_alreadyHandled.has(testSetup.readerFn)) { // Already handled?
            return;
        }
        testRecordedRead_isChanged_alreadyHandled.add(testSetup.readerFn);

        test(`${fnToString(testSetup.readerFn)}: All RecordedRead#isChanged should stay false`, () => {
            let watchedGraph = new WatchedGraph();
            const proxy = watchedGraph.getProxyFor(testSetup.origObj);
            let reads: RecordedPropertyRead[] = [];
            watchedGraph.onAfterRead(r => reads.push(r as RecordedPropertyRead));
            testSetup.readerFn!(proxy);
            reads.forEach(read => {
                if(read.isChanged) {
                    read.isChanged; // set breakpoint here
                    fail(`${read.constructor.name}.isChanged returned true`)
                }
            });
        });
    }

    function testRecordReadAndWatch<T extends object>(name: string, provideTestSetup: () => {origObj: T, readerFn?: (obj: T) => void, writerFn?: (obj: T) => void, falseReadFn?: (obj: T) => void, falseWritesFn?: (obj: T) => void, skipTestReadsAreEqual?: boolean, pickRead?: Clazz}) {
        if(provideTestSetup().readerFn && !provideTestSetup().skipTestReadsAreEqual) {
            testRecordedRead_isChanged(provideTestSetup as any);
        }
        if(provideTestSetup().writerFn) {
            testWriterConsitency(provideTestSetup as any);
        }

        for(const withNestedFacade of [false/*, true nested facades compatibility not implemented */]) {
            for (const mode of ["With writes through WatchedGraph proxy", "With writes through installed write tracker", "With writes through 2 nested WatchedGraph facades"]) {
                test(`${name} ${withNestedFacade?" With nested facade. ":""} ${mode}`, () => {
                    const testSetup = provideTestSetup();

                    //writerFn:
                    if(testSetup.writerFn && testSetup.readerFn){
                        const testSetup = provideTestSetup();
                        let watchedGraph = new WatchedGraph();
                        let origObj = testSetup.origObj;
                        if(withNestedFacade) {
                            origObj = new WatchedGraph().getProxyFor(origObj);
                        }
                        const proxy = watchedGraph.getProxyFor(origObj);
                        let reads: RecordedPropertyRead[] = [];
                        watchedGraph.onAfterRead(r => reads.push(r as RecordedPropertyRead));
                        reads = [];
                        testSetup.readerFn!(proxy);
                        expect(reads.length).toBeGreaterThan(0);
                        const lastRead = getLastRead(reads, testSetup);

                        const changeHandler = vitest.fn(() => {
                            const i = 0; // set breakpoint here
                        });
                        if (mode === "With writes through WatchedGraph proxy") {
                            lastRead.onChange(changeHandler);
                            testSetup.writerFn!(proxy);
                        } else if (mode === "With writes through installed write tracker") {
                            lastRead.onChange(changeHandler, true);
                            testSetup.writerFn!(origObj);
                        } else if (mode === "With writes through 2 nested WatchedGraph facades") {
                            lastRead.onChange(changeHandler, true);
                            let watchedGraph2 = new WatchedGraph();
                            const proxy2 = watchedGraph2.getProxyFor(origObj);
                            testSetup.writerFn!(proxy2);
                        }
                        expect(changeHandler).toBeCalledTimes(1);
                        lastRead.offChange(changeHandler);
                    }

                    //falseWriteFn:
                    if (testSetup.falseWritesFn) {
                        const testSetup = provideTestSetup();
                        let origObj = testSetup.origObj;
                        let watchedGraph = new WatchedGraph();
                        const proxy = watchedGraph.getProxyFor(withNestedFacade?new WatchedGraph().getProxyFor(testSetup.origObj):testSetup.origObj);
                        let reads: RecordedPropertyRead[] = [];
                        watchedGraph.onAfterRead(r => reads.push(r as RecordedPropertyRead));
                        reads = [];
                        testSetup.readerFn!(proxy);
                        const lastRead = getLastRead(reads, testSetup);

                        const changeHandler = vitest.fn(() => {
                            const i = 0; // set breakpoint here
                        });
                        if (mode === "With writes through WatchedGraph proxy") {
                            lastRead.onChange(changeHandler);
                            testSetup.falseWritesFn!(proxy);
                        } else if (mode === "With writes through installed write tracker") {
                            lastRead.onChange(changeHandler, true);
                            testSetup.falseWritesFn!(origObj);
                        } else if (mode === "With writes through 2 nested WatchedGraph facades") {
                            lastRead.onChange(changeHandler, true);
                            let watchedGraph2 = new WatchedGraph();
                            const proxy2 = watchedGraph2.getProxyFor(origObj);
                            testSetup.falseWritesFn!(proxy2);
                        }
                        expect(changeHandler).toBeCalledTimes(0);
                        lastRead.offChange(changeHandler);
                    }


                    //falseReadFn:
                    if (testSetup.falseReadFn !== undefined) {
                        const testSetup = provideTestSetup();
                        let origObj = testSetup.origObj;
                        let watchedGraph = new WatchedGraph();
                        const proxy = watchedGraph.getProxyFor(withNestedFacade?new WatchedGraph().getProxyFor(testSetup.origObj):testSetup.origObj);
                        let reads: RecordedPropertyRead[] = [];
                        watchedGraph.onAfterRead(r => reads.push(r as RecordedPropertyRead));
                        testSetup.falseReadFn!(proxy);
                        expect(reads.length).toBeGreaterThan(0);
                        const lastRead = getLastRead(reads, testSetup);
                        const changeHandler = vitest.fn(() => {
                            const i = 0;// set breakpoint here
                        });

                        if (mode === "With writes through WatchedGraph proxy") {
                            lastRead.onChange(changeHandler);
                            testSetup.writerFn!(proxy);
                        } else if (mode === "With writes through installed write tracker") {
                            lastRead.onChange(changeHandler, true);
                            testSetup.writerFn!(origObj);
                        } else if (mode === "With writes through 2 nested WatchedGraph facades") {
                            lastRead.onChange(changeHandler, true);
                            let watchedGraph2 = new WatchedGraph();
                            const proxy2 = watchedGraph2.getProxyFor(origObj);
                            testSetup.writerFn!(proxy2);
                        }

                        expect(changeHandler).toBeCalledTimes(0);
                        lastRead.offChange(changeHandler);
                    }
                });
            }
        }
        for(const withTrackOriginal of [false, true]) {
            if(provideTestSetup().readerFn && !provideTestSetup().skipTestReadsAreEqual) {
                test(`${name}: Recorded reads are equal, when run twice${withTrackOriginal ? ` with track original` : ""}`, () => {
                    // readerFns reads are equal?
                    const testSetup = provideTestSetup();
                    let watchedGraph = new WatchedGraph();
                    const proxy = watchedGraph.getProxyFor(testSetup.origObj);
                    let reads: RecordedRead[] = [];
                    watchedGraph.onAfterRead(r => {
                        reads.push(r as RecordedPropertyRead);
                        if (withTrackOriginal) {
                            r.onChange(() => {
                            }, true);
                        }
                    });

                    // 1st time:
                    testSetup.readerFn!(proxy);
                    expect(reads.length).toBeGreaterThan(0);
                    const reads1 = reads;

                    // 2nd time:
                    reads = [];
                    testSetup.readerFn!(proxy);
                    const reads2 = reads;

                    expect(recordedReadsArraysAreEqual(reads1, reads2)).toBeTruthy();
                })
            }
        }

        function getLastRead(reads: RecordedRead[], testSetup: ReturnType<typeof provideTestSetup>) {
            const r = testSetup.pickRead?reads.filter(r => r instanceof testSetup.pickRead!):reads;
            expect(r.length).toBeGreaterThan(0);
            return r[r.length - 1];
        }
    }


    testRecordReadAndWatch("Set object property", () => {
        const obj: {someProp?: string} = {};
        return {
            origObj: obj,
            readerFn: (obj) => {read(obj.someProp)},
            writerFn: (obj) => {obj.someProp = "123"},
            falseReadFn: (obj) => {read((obj as any).someOtherProp)},
        }
    });

    testRecordReadAndWatch("Set object property2", () => {
        const obj: {someProp?: string} = {someProp: "123"};
        return {
            origObj: obj,
            readerFn: (obj) => {read(obj.someProp)},
            writerFn: (obj) => {obj.someProp = "456"},
            falseWritesFn: (obj) => {obj.someProp="123" /* same value */}
        }
    });

    for(const mode of [{name: "Object.keys", readerFn: (obj: object) => read(Object.keys(obj))}, {name: "For...in", readerFn: (obj: object) => {for(const key in obj) read(key)}}]) {

        testRecordReadAndWatch(`${mode.name}`, () => {
            const obj: Record<string, unknown> = {existingProp: "123"};
            return {
                origObj: obj,
                readerFn: mode.readerFn,
                writerFn: (obj) => {obj.someOtherProp = "456"},
                falseWritesFn: (obj) => {obj.existingProp="new";}
            }
        });


        testRecordReadAndWatch(`${mode.name} with delete`, () => {
            const obj: Record<string, unknown> = {existingProp: "123"};
            return {
                origObj: obj,
                readerFn: mode.readerFn,
                writerFn: (obj) => {deleteProperty(obj, "existingProp" as any)},
                falseWritesFn: (obj) => {obj.existingProp="new"; deleteProperty (obj as any, "anotherProp")}
            }
        });
    }

    testRecordReadAndWatch("Delete object property", () => {
        const obj: {someProp?: string} = {someProp: "123"};
        return {
            origObj: obj,
            readerFn: (obj) => {read(obj.someProp)},
            writerFn: (obj) => {deleteProperty(obj as any, "someProp")},
            falseReadFn: (obj) => {read((obj as any).someOtherProp)},
            falseWritesFn: (obj) => {deleteProperty (obj as any, "anotherProp")}
        }
    });

    testRecordReadAndWatch("Set deep property", () => {
        const obj: {someDeep: {someProp?: string}} = {someDeep: {}};
        return {
            origObj: obj,
            readerFn: (obj) => {read(obj.someDeep.someProp)},
            writerFn: (obj) => {obj.someDeep.someProp = "123"},
            falseReadFn: (obj) => {read((obj as any).someOtherDeep);},
            falseWritesFn: (obj) => {(obj as any).someOtherDeep = "345";}
        }
    });

    testRecordReadAndWatch("Set deep property2", () => {
        const obj: {someDeep: {someProp?: string}} = {someDeep: {someProp:"123"}};
        return {
            origObj: obj,
            readerFn: (obj) => {read(obj.someDeep.someProp)},
            writerFn: (obj) => {obj.someDeep.someProp = "345"},
            falseWritesFn: (obj) => {obj.someDeep.someProp="123" /* same value */}
        }
    });


    testRecordReadAndWatch("Set deep property 3", () => {return {
            origObj: {someDeep: {}} as any,
            writerFn: (obj) => {obj.someDeep.someProp = "123"},
            falseReadFn: (obj) => {read((obj as any).someDeep.someOtherProp)},
    }});

    testRecordReadAndWatch<string[]>("Read values of an array", () => {
        const obj: {} = {};
        return {
            origObj: ["a", "b", "c"],
            readerFn: (obj) => {read([...obj])},
            writerFn: (obj) => {obj.push("d")},
            falseWritesFn: (obj) => {obj[1] = "b"}
        }
    });

    testRecordReadAndWatch<string[]>("Read array.length", () => {
        const obj: {} = {};
        return {
            origObj: ["a", "b", "c"],
            readerFn: (obj) => {read(obj.length)},
            writerFn: (obj) => {obj.push("d")},
            falseWritesFn: (obj) => {obj[1] = "b"}
        }
    });

    // Key iteration:
    for(const mode of [{name: "Object.keys", readerFn: (obj: Array<unknown>) => read(Object.keys(obj))}, {name: "For...in", readerFn: (obj: Array<unknown>) => {for(const key in obj) read(key)}}]) {

        for(const writerFn of [(arr: Array<unknown>) => {arr.push("b")}, (arr:Array<unknown>) => arr.pop(), (arr: Array<unknown>) => arr[4] = "new", (arr: Array<unknown>) => arr[6] = "new", (arr: Array<unknown>) => deleteProperty(arr, 0)] ) {
            testRecordReadAndWatch(`Arrays with ${mode.name} with ${fnToString(writerFn)}`, () => {
                return {
                    origObj: ["a", 1, 2, {}],
                    readerFn: mode.readerFn,
                    writerFn
                }
            });
        }

        testRecordReadAndWatch(`Arrays with ${mode.name} with false writes`, () => {
            return {
                origObj: ["a", 1, 2, {}],
                readerFn: mode.readerFn,
                falseWritesFn: (arr) => {arr[0] = "a";}
            }
        });
    }

    const arrayIteratorFns: {readerFn: ((arr: Array<unknown>) => void), skipTestReadsAreEqual?: boolean, pickRead?: Clazz}[] = [{readerFn: arr => {for(const val of arr) read(val)}}, {readerFn:arr => read(arr.keys()), skipTestReadsAreEqual: true}, {readerFn:arr => read(arr.values())}, {readerFn:arr => read(arr.entries())}, {readerFn:arr => arr.forEach(v => read(v)), pickRead: RecordedArrayValuesRead}];
    const arrayChangeFns = [(arr: Array<unknown>) => {arr.push("b")}, (arr:Array<unknown>) => {arr[1] = 123}, (arr:Array<unknown>) => arr.pop(), (arr: Array<unknown>) => arr[4] = "new", (arr: Array<unknown>) => arr[6] = "new", (arr: Array<unknown>) => deleteProperty(arr, 0)];
    // Value iteration:
    for(const it of arrayIteratorFns) {
        const readerFn = it.readerFn
        for(const writerFn of arrayChangeFns ) {
            testRecordReadAndWatch(`Arrays with ${fnToString(readerFn)}} with ${fnToString(writerFn)}`, () => {
                return {
                    origObj: ["a", 1, 2, {}],
                    readerFn,
                    writerFn,
                    skipTestReadsAreEqual: it.skipTestReadsAreEqual,
                    pickRead: it.pickRead,
                }
            });
        }

        testRecordReadAndWatch(`Arrays with ${fnToString(readerFn)}} with false writes`, () => {
            return {
                origObj: ["a", 1, 2, {}],
                readerFn,
                falseWritesFn: (arr) => {arr[0] = "a";},
                skipTestReadsAreEqual: it.skipTestReadsAreEqual,
                pickRead: it.pickRead,
            }
        });
    }


    // TODO: non enumerable properties

    for(const readWriteFn of [(arr: any[]) => arr.pop()] ) {
        testRecordReadAndWatch(`Arrays with Read-Write method: ${fnToString(readWriteFn)}`, () => {
            return {
                origObj: ["a", 1, 2, {}],
                readerFn: readWriteFn,
                writerFn: readWriteFn,
                skipTestReadsAreEqual: true
            }
        });
    }

    for(const readerFn of [(obj: string[]) => Object.keys(obj), (obj: string[]) => obj[0], (obj: string[]) => {for(const o of obj) read(o)}]) {
         testRecordReadAndWatch(`Future functionality of array with reader: ${fnToString(readerFn)}`, () => {
            return {
                origObj: ["a", "b", "c"],
                readerFn,
                writerFn: (obj) => {
                    function someFuturisticMethod(this: unknown, a: unknown, b: unknown) {
                        return {a, b, me: this};
                    }

                    //@ts-ignore
                    Array.prototype.someFuturisticMethod = someFuturisticMethod; // Enhance Array
                    try {
                        const result = (obj as any).someFuturisticMethod("a", "b");
                        // Check if params were handed correctly
                        expect(result.a).toBe("a")
                        expect(result.b).toBe("b")

                        expect(result.me === obj).toBeTruthy(); // Expect to someFuturisticMethod to receive the proper "this"
                    } finally {
                        //@ts-ignore
                        delete Array.prototype.someFuturisticMethod;
                    }

                },
            }
        });
    }

    testRecordReadAndWatch(`Future/unhandled read methods on array should fire an unspecific read`, () => {
        return {
            origObj: ["a", "b", "c"],
            readerFn: (obj) => {
                function someFuturisticMethod(this: unknown, a: unknown, b: unknown) {
                    return {a, b, me: this};
                }

                //@ts-ignore
                Array.prototype.someFuturisticMethod = someFuturisticMethod; // Enhance Array
                try {
                    const result = (obj as any).someFuturisticMethod("a", "b");
                    // Check if params were handed correctly
                    expect(result.a).toBe("a")
                    expect(result.b).toBe("b")

                    expect(result.me === obj).toBeTruthy(); // Expect to someFuturisticMethod to receive the proper "this"
                } finally {
                    //@ts-ignore
                    delete Array.prototype.someFuturisticMethod;
                }

            },
            writerFn: (obj) => {obj[3] = "d"},
            skipTestReadsAreEqual: true

        }
    });


    testRecordReadAndWatch<string[]>("methods from Object.prototype called on an array", () => {
        return {
            origObj: ["a", "b", "c"],
            readerFn: (obj) => {expect(obj.toString()).toBe('a,b,c')},
        }
    });

    testRecordReadAndWatch("array.unshift", () => {return {
        origObj: ["a", "b", "c"],
        readerFn: (obj: string[]) =>  read(obj[0]),
        writerFn: (obj: string[]) =>  obj.unshift("_a","_b"),
    }});

    testRecordReadAndWatch("array.unshift with .length", () => {return {
            origObj: ["a", "b", "c"],
            readerFn: (obj: string[]) =>  read(obj.length),
            writerFn: (obj: string[]) =>  obj.unshift("_a","_b"),
    }});

    // TODO: is the result of i.e. array.unshift a proxy as well?

    testRecordReadAndWatch<Set<unknown>>("Set.add", () => {
        const obj: Set<string> = new Set<string>;
        return {
            origObj: obj,
            readerFn: (obj) => obj.has("a"),
            writerFn: (obj) => obj.add("a"),
            falseReadFn: (obj) => {obj.has("b")},
            falseWritesFn: (obj) => {obj.add("b")}
        }
    });

    testRecordReadAndWatch<Set<unknown>>("Set.add as non-change (value already exists)", () => {
        const obj: Set<string> = new Set<string>(["a", "b"]);
        return {
            origObj: obj,
            readerFn: (obj) => obj.has("a"),
            falseWritesFn: (obj) => {obj.add("a")}
        }
    });

    const iterateSetFns: ((set: Set<unknown>) => void)[] = [set => set.keys(), set => set.values(), set => set.forEach(x => read(x)), set => {for(const o of set) read(o)}, set => read(set.size)];
    const changeSetFns:((set: Set<unknown>) => void)[] = [set => set.add("d"), set => set.delete("b"), set => set.clear()]
    for(const readerFn of iterateSetFns) {
        for(const writerFn of changeSetFns) {
            testRecordReadAndWatch<Set<unknown>>(`Iterate set: ${fnToString(readerFn)} with ${fnToString(writerFn)}`, () => {
                return {
                    origObj: new Set<string>(["a", "b"]),
                    readerFn,
                    writerFn
                }
            });
        }
    }


    testRecordReadAndWatch<Map<unknown, unknown>>("Map.has with Map.set", () => {
        const obj: Map<string,string> = new Map<string,string>;
        return {
            origObj: obj,
            readerFn: (obj) => obj.has("a"),
            writerFn: (obj) => obj.set("a", {}),
            falseReadFn: (obj) => {obj.has("b")},
            falseWritesFn: (obj) => {obj.set("b", "c")}
        }
    });

    testRecordReadAndWatch<Map<string, unknown>>("Map.get with Map.set", () => {
        const obj: Map<string,string> = new Map<string,string>([["a","valueA"], ["b","valueB"]]);
        return {
            origObj: obj,
            readerFn: (obj) => expect(obj.get("a")).toBe("valueA"),
            writerFn: (obj) => obj.set("a", {val: "somethingElse"}),
            falseReadFn: (obj) => {obj.has("b"); obj.get("b")},
            falseWritesFn: (obj) => {obj.set("a", "valueA")} // No actual change
        }
    });

    {
        const createOrigMap = () => new Map<string,unknown>([["a","valueA"], ["b",{some: "valueB"}]]);
        const changeMapFns:((map: Map<unknown, unknown>) => void)[] = [map => map.set("d", {}), map => map.delete("b"), map => map.clear()]

        const iterateMapKeysFns: ((map: Map<unknown, unknown>) => void)[] = [map => map.keys(), map => read(map.size)];
        for(const readerFn of iterateMapKeysFns) {
            for(const writerFn of changeMapFns) {
                testRecordReadAndWatch<Map<unknown, unknown>>(`Iterate map keys: ${fnToString(readerFn)} with ${fnToString(writerFn)}`, () => {
                    return {
                        origObj: createOrigMap(),
                        readerFn,
                        writerFn,
                        falseWritesFn: obj => obj.set("a", "differentValue")
                    }
                });
            }
        }

        const iterateMapValuesFns: ((map: Map<unknown, unknown>) => void)[] = [map => map.values(), map => map.forEach(x => read(x)), map => {for(const o of map) read(o)}];
        for(const readerFn of iterateMapValuesFns) {
            for(const writerFn of changeMapFns) {
                testRecordReadAndWatch<Map<unknown, unknown>>(`Iterate map values: ${fnToString(readerFn)} with ${fnToString(writerFn)}`, () => {
                    return {
                        origObj: createOrigMap(),
                        readerFn,
                        writerFn,
                    }
                });
            }
        }
    }


    testRecordReadAndWatch<Map<unknown, unknown>>("Map.keys() (more fine granualar)", () => {
        const map: Map<string,string> = new Map<string,string>([["keyA", "valueA"], ["keyB", "valueB"]]);
        return {
            origObj: map,
            readerFn: (map) => read(map.keys()),
            writerFn: (map) => map.set("keyC", "valueC"),
            falseReadFn: (map) => {map.has("keyX")},
            falseWritesFn: (map) => {map.set("keyA", "differentVALUE")} // only the value differs
        }
    });

    testRecordReadAndWatch<Map<unknown, unknown>>("Map.values() (more fine granualar)", () => {
        const map: Map<string,string> = new Map<string,string>([["keyA", "valueA"], ["keyB", "valueB"]]);
        return {
            origObj: map,
            readerFn: (map) => read(map.values()),
            writerFn: (map) => map.set("keyA", "newValue"),
            falseWritesFn: (map) => {map.set("keyA", "valueA")},
        }
    });

    // TODO: self infect / querying if Set/Map has a key should unbox the key. Same for all all values, also arrays and objects!?



    /* Template:
    testRecordReadAndWatch("xxx", () => {
        const obj: {} = {};
        return {
            origObj: obj,
            readerFn: (obj) => {...},
            writerFn: (obj) => {...},
            falseReadFn: (obj) => {},
            falseWritesFn: (obj) => {}
        }
    });
    */
});

describe('WatchedGraph integrity', () => {
    testWriterConsitency(() => {return {
        origObj: ["a", "b", "c"],
        writerFn: (obj: string[]) => {
            expect(obj.push("d")).toEqual(4);
            expect(obj.length).toEqual(4);

            expect(obj.push("e","f")).toEqual(6);
        }}
    },"array.push (various)");

    testWriterConsitency(() => {return {
        origObj: ["a", "b", "c"],
        writerFn: (obj: string[]) => {
            expect(obj.pop()).toEqual("c");
            expect(obj.length).toEqual(2);
        }}
    },"array.pop (various)");


    testWriterConsitency(() => {
        const makeArray = (value: unknown[]) => {
            let result: unknown[] = [];
            for (const i in value) {
                if (value[i] !== undefined) {
                    result[i] = value[i];
                }
            }
            return result
        }

        return {
        origObj: makeArray(["a", undefined, undefined, "d"]),
        writerFn: (obj: unknown[]) => {
            expect(obj.length).toEqual(4);
            expect([...Object.keys(obj)]).toEqual(["0", "3"]);
            expect(obj.pop()).toEqual("d");
            expect(obj.length).toBe(3);
        }}
    },"arrays with gaps");


    testWriterConsitency(() => {return {
        origObj: ["a", "b", "c"],
        writerFn: (obj: string[]) => {
            expect(obj.unshift("_a","_b")).toBe(5);
            expect([...obj]).toEqual(["_a","_b", "a", "b", "c"]);
        }}
    },"array.unshift");



    testWriterConsitency(() => {return {
        origObj: ["a", "b", "c","d"],
        writerFn: (obj: string[]) => {
            expect(obj.splice(1,2, "newB", "newC", "newX")).toEqual(["b","c"]);
            expect([...obj]).toEqual(["a", "newB", "newC", "newX", "d"]);
        }}
    },"array.splice");



    testWriterConsitency(() => {return {
        origObj: ["a", "b", "c","d"] as any[],
        writerFn: (obj: string[]) => {
            expect([...obj.copyWithin(3, 1,3)]).toEqual(["a", "b", "c","b"]);
            expect(obj.length).toBe(4);
        }}
    },"array.copyWithin");

    testWriterConsitency(() => {return {
        origObj: ["a", "b", "c","d"] as any[],
        writerFn: (obj: string[]) => {
            expect([...obj.reverse()]).toEqual(["d", "c", "b","a"]);
            expect([...obj]).toEqual(["d", "c", "b","a"]);
        }}
    },"array.reverse");


    testWriterConsitency(() => {return {
        origObj: new Set<string>(),
        writerFn: (set: Set<string>) => {
            set.add("a");set.add("b");set.add("a");
            expect(set.has("a")).toBeTruthy();
            expect(set.has("c")).toBeFalsy();
            expect(set.size).toEqual(2);
            expect([...set.keys()]).toEqual(["a","b"]);
            expect([...set.values()]).toEqual(["a","b"]);
            expect([...set.entries()]).toEqual([["a", "a"],["b","b"]]);
            expect(set[Symbol.iterator]().next().value).toEqual("a");
            const res: string[] = [];
            set.forEach(v => res.push(v));
            expect(res).toEqual(["a","b"]);
            expect(set.delete("c")).toBeFalsy();
            expect(set.size).toEqual(2);
            expect(set.delete("b")).toBeTruthy();
            expect(set.size).toEqual(1);
            set.clear();
            expect(set.size).toEqual(0);
        }}
    },"Set");

});

describe("Returning proxies", () => {
    class WgUtils {
        watchedGraph: WatchedGraph

        constructor(watchedGraph: WatchedGraph) {
            this.watchedGraph = watchedGraph;
        }

        expectProxy(obj: object) {
            if (this.watchedGraph.getProxyFor(obj) !== obj) {
                fail("obj is not a proxy");
            }
        }

        expectNonProxy(obj: object) {
            if (this.watchedGraph.getProxyFor(obj) === obj) {
                fail("obj is a proxy");
            }
        }
    }

    test("Object properties should be proxies", () => {
        const watchedGraph = new WatchedGraph();
        const utils = new WgUtils(watchedGraph);

        const orig = {
            prop: {child: "initialValue"} as object,

            get byAccessor() {
                return this.prop;
            },

            set byAccessor(value: object) {
                this.prop = value;
            },

            setProp(value: object) {
                this.prop = value;
            }
        }
        const proxyedObj = watchedGraph.getProxyFor(orig);
        utils.expectProxy(proxyedObj);
        utils.expectProxy(proxyedObj.prop);

        // setting non-proxied
        proxyedObj.prop = {child: "newValue"}
        utils.expectProxy(proxyedObj.prop);
        utils.expectNonProxy(orig.prop);

        // setting proxied
        proxyedObj.prop = watchedGraph.getProxyFor({child: "newValue"})
        utils.expectProxy(proxyedObj.prop);
        utils.expectNonProxy(orig.prop);

        utils.expectProxy(proxyedObj.byAccessor);
        proxyedObj.byAccessor= {child: "newValue"}
        utils.expectProxy(proxyedObj.prop)
        utils.expectNonProxy(orig.prop)

        proxyedObj.byAccessor= watchedGraph.getProxyFor({child: "newValue"})
        utils.expectProxy(proxyedObj.prop)
        utils.expectNonProxy(orig.prop)

        proxyedObj.setProp({child: "newValue"})
        utils.expectProxy(proxyedObj.prop)
        utils.expectNonProxy(orig.prop)

        proxyedObj.setProp(watchedGraph.getProxyFor({child: "newValue"}))
        utils.expectProxy(proxyedObj.prop)
        utils.expectNonProxy(orig.prop)
    })

    test("User methods should return proxies", () => {
        const watchedGraph = new WatchedGraph();
        const utils = new WgUtils(watchedGraph);

        const orig = {
            someObj: {some: "value"},
            userMethod() {
                return this.someObj
            },

            equalsSomeObject(candidate: object) {
                return this.someObj === candidate;
            }
        }
        const proxy = watchedGraph.getProxyFor(orig);
        utils.expectProxy(proxy);
        utils.expectProxy(proxy.someObj);
        utils.expectProxy(proxy.userMethod());

        expect(proxy.equalsSomeObject(proxy.someObj)).toBeTruthy(); // Behaviour should be consistent
    })

    test("Array should return proxies", () => {
        const watchedGraph = new WatchedGraph();
        const utils = new WgUtils(watchedGraph);

        const obj1 = {};
        const obj2 = {};
        const orig = [obj1,obj2]
        const proxy = watchedGraph.getProxyFor(orig);
        utils.expectProxy(proxy);
        utils.expectProxy(proxy[0]);
        proxy.push({x: "123"})
        utils.expectProxy(proxy[2]);
        utils.expectNonProxy(orig[2]);
        proxy.push(proxy[0]); // add again
        utils.expectNonProxy(orig[3]);
        utils.expectProxy(orig.pop()!);
    })




    test("Setting properties on an object should not self-infect", () => {
        const watchedGraph = new WatchedGraph();
        const utils = new WgUtils(watchedGraph);

        const orig = {
            someObj: {some: "value"} as object,
            setSomeObj(value: object) {
                this.someObj = value;
            },
        }
        const proxy = watchedGraph.getProxyFor(orig);

        const anotherObj = {prop: "another"};
        proxy.setSomeObj(anotherObj);
        utils.expectNonProxy(orig.someObj);
        utils.expectProxy(proxy.someObj);

        proxy.setSomeObj(watchedGraph.getProxyFor(anotherObj));
        utils.expectNonProxy(orig.someObj);
        utils.expectProxy(proxy.someObj);
    })

    test("Proxies with set", () => {
        const watchedGraph = new WatchedGraph();
        const utils = new WgUtils(watchedGraph);

        const origSet = new Set<object>();
        const proxyedSet = watchedGraph.getProxyFor(origSet);

        const storedObjOrig = {some: "value"};
        const storedObjectProxy = watchedGraph.getProxyFor(storedObjOrig);
        proxyedSet.add(storedObjectProxy);
        utils.expectNonProxy(origSet.keys().next().value!);
        utils.expectNonProxy(origSet.values().next().value!);
        utils.expectProxy(proxyedSet.values().next().value!);
        utils.expectProxy(proxyedSet.entries().next().value!);
        utils.expectProxy([...proxyedSet][0]);

        expect(proxyedSet.has(storedObjectProxy)).toBeTruthy()
        expect(proxyedSet.has(storedObjOrig)).toBeFalsy();

        // TODO: baseline 2024 methods (intersection, ...)
    })

    test("Proxies with map", () => {
        const watchedGraph = new WatchedGraph();
        const utils = new WgUtils(watchedGraph);

        const origMap = new Map<object,object>();
        const proxyedMap = watchedGraph.getProxyFor(origMap);

        const origValue = {some: "value"};
        const valueProxy = watchedGraph.getProxyFor(origValue);

        const origKey = {some: "theKey"};
        const keyProxy = watchedGraph.getProxyFor(origKey);

        proxyedMap.set(origKey, origValue);
        utils.expectNonProxy(origMap.keys().next().value!);
        utils.expectNonProxy(origMap.values().next().value!);
        expect(origMap.has(origKey)).toBeTruthy();
        expect(origMap.has(keyProxy)).toBeFalsy();
        expect(proxyedMap.has(keyProxy)).toBeTruthy();
        utils.expectProxy(proxyedMap.get(keyProxy)!);

        utils.expectProxy([...proxyedMap.values()][0]);
        utils.expectProxy([...proxyedMap.keys()][0]);
        utils.expectProxy(proxyedMap.entries().next().value![0]);
        utils.expectProxy(proxyedMap.entries().next().value![1]);
        proxyedMap.forEach((value, key) => {
            utils.expectProxy(value);
            utils.expectProxy(key);
        })
        utils.expectProxy([...proxyedMap][0][0]); // First key
        utils.expectProxy([...proxyedMap][0][1]); // first value

    })
});

function fnToString(fn: (...args: any[]) => unknown) {
    return fn.toString().replace(/\s+/g," ").toString();
}

function enhanceWithWriteTrackerDeep(obj: object) {
    visitReplace(obj, (value, visitChilds, context) => {
        if(isObject(value)) {
            enhanceWithWriteTracker(value);
        }
        return visitChilds(value, context)
    })
}

/**
 * Test, if writerFn behaves normal when used through the watchedgraph, etc.
 * @param name
 * @param provideTestSetup
 */
function testWriterConsitency<T extends object>(provideTestSetup: () => {origObj: T, writerFn: (obj: T) => void}, name?: string) {
    for (const mode of ["With writes through WatchedGraph proxy", "With writes through installed write tracker"]) {
        test(`WriterFn ${name || fnToString(provideTestSetup().writerFn)} should behave normally. ${mode}`, () => {
            const origForCompareTestSetup = provideTestSetup();
            origForCompareTestSetup.writerFn(origForCompareTestSetup.origObj);

            if (mode === "With writes through WatchedGraph proxy") {
                const testSetup = provideTestSetup();
                const proxy = new WatchedGraph().getProxyFor(testSetup.origObj)
                testSetup.writerFn(proxy);
                expect(_.isEqual(proxy, origForCompareTestSetup.origObj)).toBeTruthy();
                expect(_.isEqual(testSetup.origObj, origForCompareTestSetup.origObj)).toBeTruthy();
            } else if (mode === "With writes through installed write tracker") {
                const testSetup = provideTestSetup();
                const proxy = new WatchedGraph().getProxyFor(testSetup.origObj);
                enhanceWithWriteTrackerDeep(testSetup.origObj);
                testSetup.writerFn(testSetup.origObj);
                expect(_.isEqual(proxy, origForCompareTestSetup.origObj)).toBeTruthy();
                expect(_.isEqual(testSetup.origObj, origForCompareTestSetup.origObj)).toBeTruthy();
            }
        });
    }
}

