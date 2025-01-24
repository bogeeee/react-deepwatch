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
import {Clazz, ObjKey} from "./common";
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

    function testRecordReadAndWatch<T extends object>(name: string, provideTestSetup: () => {origObj: T, readerFn?: (obj: T) => void, writerFn?: (obj: T) => void, falseReadFn?: (obj: T) => void, falseWritesFn?: (obj: T) => void, skipTestReadsAreEqual?: boolean, pickReader?: Clazz}) {
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
                        const lastRead = getLastRead(reads, testSetup);

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
                        const lastRead = getLastRead(reads, testSetup);

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
                        const lastRead = getLastRead(reads, testSetup);
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

        function getLastRead(reads: RecordedRead[], testSetup: ReturnType<typeof provideTestSetup>) {
            const r = testSetup.pickReader?reads.filter(r => r instanceof testSetup.pickReader!):reads;
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

    const arrayChangeFns = [(arr: Array<unknown>) => {arr.push("b")}, (arr:Array<unknown>) => {arr[1] = 123}, (arr:Array<unknown>) => arr.pop(), (arr: Array<unknown>) => arr[4] = "new", (arr: Array<unknown>) => arr[6] = "new", (arr: Array<unknown>) => deleteProperty(arr, 0)];
    // Value iteration:
    for(const mode of [{name: "For...of", readerFn: (obj: Array<unknown>) => {for(const val of obj) read(val)}}]) {
        for(const writerFn of arrayChangeFns ) {
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
    for (const writerFn of arrayChangeFns) {
        testRecordReadAndWatch(`Arrays with forEach with ${fnToString(writerFn)}`, () => {
            return {
                origObj: ["a", 1, 2, {}],
                readerFn: (obj: Array<unknown>) => obj.forEach(v => read(v)  ),
                writerFn,
                pickReader: RecordedArrayValuesRead
            }
        });
    }



    // TODO: Test, if behaviour is normal. I.e. push object to an array an check .length


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