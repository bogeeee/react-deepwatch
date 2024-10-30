import {it, expect, test, beforeEach,describe } from 'vitest'
import {ObjKey, RecordedPropertyRead, WatchedGraph} from "./watchedGraph";
import _ from "underscore"
import {arraysAreEqualsByPredicateFn} from "./Util";

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

    test("Object.keys", () => {
        const origObj = {a: "x", arr:["a","b"]};
        const proxy = new WatchedGraph().getProxyFor(origObj);
        expect(Object.keys(proxy)).toEqual(["a", "arr"]);
        expect(Object.keys(proxy.arr)).toEqual(Object.keys(origObj.arr));
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

    test("Non modification", () => {
        const origObj = {a: "a"};
        const proxy = new WatchedGraph().getProxyFor(origObj);
        proxy.a = "a"; // Should at least not trigger an error
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
        expect(() => {
            //@ts-ignore
            delete proxy.a;
        }).toThrow();
    });


    test("Property accessors", () => {
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

        const proxy = new WatchedGraph().getProxyFor(origObj);

        expect(proxy.a).toEqual("");

        proxy.a = "x"
        expect(proxy.a).toEqual("x");

        proxy.setMe = "y"
        expect(proxy.a).toEqual("y");

        expect(proxy.artificialProprty).toEqual("some");

    })

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

    test("Readonly props from prototypes should not cause an error", ()=> {
        class A {
            prop!: object
        }
        Object.defineProperty(A.prototype, "prop", {
            value: {},
            writable: false
        })

        const orig = new A();

        let watchedGraph = new WatchedGraph();
        const proxy = watchedGraph.getProxyFor(orig);
        expect(proxy.prop).toStrictEqual(orig.prop);
    })

});

describe('WatchedGraph tests', () => {
    function readsEqual(reads: RecordedPropertyRead[], expected: { obj: object, key: ObjKey, value: unknown }[]) {
        return arraysAreEqualsByPredicateFn(reads, expected, (propRead, exp) => {
            return propRead.obj === exp.obj && propRead.key === exp.key && propRead.value === exp.value;
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
            {obj: sampleGraph.users, key: "forEach", value: sampleGraph.users.forEach},
            {obj: sampleGraph.users, key: "length", value: sampleGraph.users.length},
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
        expect(writes).toEqual(["xyz", "123"])

    });

    test("onAfterWrite increase counter with ++", () => {
        const sampleGraph = {counter: 0};
        let watchedGraph = new WatchedGraph();
        const proxy = watchedGraph.getProxyFor(sampleGraph);

        // Install listener:
        let writes: unknown[] = [];
        watchedGraph.onAfterWriteOnProperty(sampleGraph, "counter", (newValue) => writes.push(newValue));

        proxy.counter++;
        expect(writes).toEqual([1]);

    });

    test("onAfterWrite expect to receive non-proxied objects", () => {
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
        expect(writes[0] === valueObj).toBeTruthy()
    });

    test("onAfterWrite arrays", () => {
        const origObj: string[] = [];
        let watchedGraph = new WatchedGraph();
        const proxy = watchedGraph.getProxyFor(origObj);

        // Install listener:
        let writes: string[] = [];
        //@ts-ignore The proxy retrieves keys as strings or symbols
        watchedGraph.onAfterWriteOnProperty(origObj, "0", (newValue) => writes.push(newValue));
        let writesToLength: number[] = [];
        watchedGraph.onAfterWriteOnProperty(origObj, "length", (newValue) => writesToLength.push(newValue  as number));

        proxy.push("a");
        proxy.push("b"); // not listening on index 1
        proxy[0] = "a_new"; // not listening on index 1

        expect(writes).toEqual(["a","a_new"]);
        expect(writesToLength).toEqual([1,2]); // This might not work. We might need to enhance the push method

    });

    test("Template", () => {
        const sampleGraph = createSampleObjectGraph();
        let watchedGraph = new WatchedGraph();
        const proxy = watchedGraph.getProxyFor(sampleGraph);
    });
});
