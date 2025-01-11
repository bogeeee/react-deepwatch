import {it, expect, test, beforeEach,describe, vitest, vi} from 'vitest'
import {
    RecordedArrayValuesRead,
    RecordedPropertyRead,
    RecordedRead,
    recordedReadsArraysAreEqual,
    WatchedGraph
} from "./watchedGraph";
import _ from "underscore"
import {arraysAreEqualsByPredicateFn} from "./Util";
import {ObjKey} from "./common";
import {deleteProperty, enhanceWithWriteTracker} from "./globalWriteTracking";
import {ProxiedGraph} from "./proxiedGraph";

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
        watchedGraph.onAfterWriteOnProperty(sampleGraph, "appName", (newValue) => writes.push(newValue));

        proxy.appName = "xyz"; proxy.appName = "123";
        expect(writes.length).toEqual(2)

    });

    test("onAfterWrite increase counter with ++", () => {
        const sampleGraph = {counter: 0};
        let watchedGraph = new WatchedGraph();
        const proxy = watchedGraph.getProxyFor(sampleGraph);

        // Install listener:
        let writes: unknown[] = [];
        watchedGraph.onAfterWriteOnProperty(sampleGraph, "counter", (newValue) => writes.push(newValue));

        proxy.counter++;
        expect(writes.length).toEqual(1);

    });

    test("onAfterWrite expect to receive non-proxied objects or undefined", () => {
        const origObject: {myProp?: object} = {
            myProp: undefined,
        };
        const valueObj = {}
        let watchedGraph = new WatchedGraph();
        const proxy = watchedGraph.getProxyFor(origObject);

        // Install listener:
        let writes: unknown[] = [];
        watchedGraph.onAfterWriteOnProperty(origObject, "myProp", (newValue) => writes.push(newValue));

        proxy.myProp = valueObj;
        expect(writes[0] === undefined || writes[0] === valueObj).toBeTruthy()
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

    function testRecordReadAndWatch<T extends object>(name: string, provideTestSetup: () => {origObj: T, readerFn?: (obj: T) => void, writerFn?: (obj: T) => void, falseReadFn?: (obj: T) => void, falseWritesFn?: (obj: T) => void, skipTestReadsAreEqual?: boolean}) {
        for(const withNestedFacade of [false/*, true nested facades compatibility not implemented */]) {
            for (const mode of ["With writes from inside", "With writes from outside", "with write from another WatchedGraph"]) {
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
                        const lastRead = reads[reads.length - 1];

                        const changeHandler = vitest.fn(() => {
                            const i = 0; // set breakpoint here
                        });
                        if (mode === "With writes from inside") {
                            lastRead.onChange(changeHandler);
                            testSetup.writerFn!(proxy);
                        } else if (mode === "With writes from outside") {
                            lastRead.onChange(changeHandler, true);
                            testSetup.writerFn!(origObj);
                        } else if (mode === "with write from another WatchedGraph") {
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
                        const lastRead = reads[reads.length - 1];

                        const changeHandler = vitest.fn(() => {
                            const i = 0; // set breakpoint here
                        });
                        if (mode === "With writes from inside") {
                            lastRead.onChange(changeHandler);
                            testSetup.falseWritesFn!(proxy);
                        } else if (mode === "With writes from outside") {
                            lastRead.onChange(changeHandler, true);
                            testSetup.falseWritesFn!(origObj);
                        } else if (mode === "with write from another WatchedGraph") {
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
                        const lastRead = reads[reads.length - 1];
                        const changeHandler = vitest.fn(() => {
                            const i = 0;// set breakpoint here
                        });

                        if (mode === "With writes from inside") {
                            lastRead.onChange(changeHandler);
                            testSetup.writerFn!(proxy);
                        } else if (mode === "With writes from outside") {
                            lastRead.onChange(changeHandler, true);
                            testSetup.writerFn!(origObj);
                        } else if (mode === "with write from another WatchedGraph") {
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

    for(const mode of [{name: "Object.keys", readerFn: (obj: Array<unknown>) => read(Object.keys(obj))}, {name: "For...in", readerFn: (obj: Array<unknown>) => {for(const key in obj) read(key)}}, {name: "For...of", readerFn: (obj: Array<unknown>) => {for(const val of obj) read(val)}}, {name: "forEach", readerFn: (obj: Array<unknown>) => obj.forEach(v => read(v))}]) {

        for(const writerFn of [(arr: Array<unknown>) => {arr.push("b")}, (arr:Array<unknown>) => {arr[1] = 123}, (arr:Array<unknown>) => arr.pop(), (arr: Array<unknown>) => arr[4] = "new", (arr: Array<unknown>) => arr[6] = "new", (arr: Array<unknown>) => deleteProperty(arr, 0)] ) {
            testRecordReadAndWatch(`Arrays with ${mode.name} with ${fnToString(writerFn)}`, () => {
                return {
                    origObj: ["a", 1, 2, {}],
                    readerFn: mode.readerFn,
                    writerFn
                }
            });
        }

        testRecordReadAndWatch(`Arrays with ${mode.name} 2`, () => {
            return {
                origObj: ["a", 1, 2, {}],
                readerFn: mode.readerFn,
                falseWritesFn: (arr) => {arr[0] = "a";}
            }
        });
    }

    // TODO: non enumerable properties


    // TODO: arrays with gaps
    // TODO: arrays with read+write methods (at the same time): unshift, splice
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

    /* Template:
    testRecordReadAndWatch("xxx", () => {
        const obj: {} = {};
        return {
            origObj: obj,
            readerFn: (obj) => {...},
            writerFn: (obj) => () => {...},
            falseReadFn: (obj) => {},
            falseWritesFn: (obj) => {}
        }
    });
    */
});

function fnToString(fn: (args: unknown[]) => unknown) {
    return fn.toString().replace(/\s/g,"");
}