import {RecordedRead, recordedReadsArraysAreEqual, WatchedGraph} from "./watchedGraph";
import {arraysAreEqualsByPredicateFn, throwError} from "./Util";
import {useState} from "react";
import {ProxiedGraph} from "./proxiedGraph";

let watchedGraph: WatchedGraph | undefined

class RecordedLoadCall {
    /**
     * From the beginning or previous load call up to this one
     */
    recordedReadsBefore!: RecordedRead[];
    recordedReadsInsideLoaderFn!: RecordedRead[];

    result: unknown
}

/**
 * Fields that persist across re-render
 */
class WatchedComponentPersistent {
    loadCalls: RecordedLoadCall[] = [];
}

class CurrentRun {
    //watchedGraph= new WatchedGraph();
    get watchedGraph() {
        // Use a global shared instance. Because there's no exclusive state inside the graph/handlers. And state.someObj = state.someObj does not cause us multiple nesting layers of proxies. Still this may not the final choice. When changing this mind also the `this.proxyHandler === other.proxyHandler` in RecordedPropertyRead#equals
        return watchedGraph || (watchedGraph = new WatchedGraph()); // Lazy initialize global variable
    }
    recordedReads: RecordedRead[] = [];
    persistent: WatchedComponentPersistent;
    /**
     * Increased, when we see a load(...) call
     */
    loadCallIndex = 0;
    reRender: () => void

    constructor(persentent: WatchedComponentPersistent, reRender: () => void) {
        this.persistent = persentent
        this.reRender = reRender;
    }
}
let currentRun: CurrentRun| undefined;

export function WatchedComponent<PROPS extends object>(componentFn:(props: PROPS) => any) {
    return (props: PROPS) => {
        const [renderCounter, setRenderCounter] = useState(0);
        const [persistent] = useState(new WatchedComponentPersistent());

        currentRun === undefined || throwError("Illegal state: already in currentRun");

        const cleanListenerFns: (()=>void)[] = [];

        function reRender() {
            cleanListenerFns.forEach(c => c()); // Clean the listeners // TODO: use useEffect with cleanup instead.
            setRenderCounter(renderCounter+1);
        }

        currentRun = new CurrentRun(persistent, reRender);

        try {
            const watchedProps = createProxyForProps(currentRun.watchedGraph, props);

            // Install read listener:
            let readListener = (read: RecordedRead)  => {
                // Re-render on a change of the read value:
                const changeListener = (newValue: unknown) => {
                    if(currentRun) {
                        throw new Error("You must not modify a watched object during the render run.");
                    }
                    reRender();
                }
                read.onChange(changeListener);
                cleanListenerFns.push(() => read.offChange(changeListener)); // Cleanup on re-render
                currentRun!.recordedReads.push(read);
            };
            currentRun!.watchedGraph.onAfterRead(readListener)

            try {
                return componentFn(watchedProps); // Run the user's component function
            }
            catch (e) {
                if(e instanceof Promise) { // TODO: better check / better signal
                    // Quick and dirty handle the suspense ourself. Cause the react Suspense does not restore the state by useState :(
                    e.then(result => {reRender()})
                    return "...loading..."; // TODO: return loader
                }
                else {
                    throw e;
                }
            }
            finally {
                currentRun!.watchedGraph.offAfterRead(readListener);
            }
        }
        finally {
            currentRun = undefined;
        }
    }
}

function useWatched<T extends object>(obj: T): T {
    currentRun || throwError("useWatched is not used from inside a WatchedComponent");
    return currentRun!.watchedGraph.getProxyFor(obj);
}

export function useWatchedState(initial: object) {
    currentRun || throwError("useWatchedState is not used from inside a WatchedComponent");

    const [state]  = useState(initial);
    return useWatched(state);
}

/**
 * Records the values, that are **immediately** accessed in the loader function. Treats them as dependencies and re-executes the loader when any of these change.
 * <p>
 * Opposed to {@link load}, it does not treat all previously accessed properties as dependencies
 * </p>
 * <p>
 * Immediately means: Before the promise is returned. I.e. does not record any more after your fetch finished.
 * </p>
 * @param loader
 */
function useLoad<T>(loader: () => Promise<T>): T {
    return undefined as T;
}


export function load<T>(loaderFn: () => Promise<T>): T {

    // Validity checks:
    typeof loaderFn === "function" || throwError("loader is not a function");
    if(currentRun === undefined) throw new Error("load is not used from inside a WatchedComponent")

    const loadCallIndex = currentRun!.loadCallIndex;

    /**
     * Can we use the result from previous / last call ?
     */
    function canReusePreviousResult() {
        if(currentRun === undefined) throw new Error("load is not used from inside a WatchedComponent")

        if(!(loadCallIndex < currentRun.persistent.loadCalls.length)) { // call was not recorded previously ?
            return false;
        }
        const previousLoadCall = currentRun.persistent.loadCalls[loadCallIndex];

        if(!recordedReadsArraysAreEqual(currentRun.recordedReads, previousLoadCall.recordedReadsBefore)) {
            return false;
        }

        if(previousLoadCall.recordedReadsInsideLoaderFn.some((r => r.isChanged))) { // I.e for "load( () => { fetch(props.x, myLocalValue) }) )" -> props.x or myLocalValue has changed?
            return false;
        }

        return true;
    }

    if(canReusePreviousResult()) {
        const previousCall = currentRun.persistent.loadCalls[loadCallIndex];
        currentRun.recordedReads = [];
        currentRun.loadCallIndex++;

        // return proxy'ed result from previous call:
        let result = previousCall.result
        if(result !== null && typeof result === "object") {
            result = currentRun.watchedGraph.getProxyFor(result); // Record the reads inside the result as well
        }
        return result as T;
    }
    // TODO: introduce third case. Can re-use but still loading
    else { // cannot use previous result ?
        // *** make a call / exec loaderFn ***:

        currentRun.persistent.loadCalls = currentRun.persistent.loadCalls.slice(0, loadCallIndex); // Erase all snaphotted loadCalls after here (including this one). They can't be re-used because they might also depend on the result of this call (+ eventually if a property changed till here)

        let loadCall = new RecordedLoadCall();
        loadCall.recordedReadsBefore = currentRun.recordedReads;
        currentRun.recordedReads = []; // pop and remember the reads so far before the loaderFn
        const resultPromise = Promise.resolve(loaderFn()); // Exec loaderFn
        loadCall.recordedReadsInsideLoaderFn = currentRun.recordedReads;
        currentRun.recordedReads = []; // pop and remember the (immediate) reads from inside the loaderFn

        const persistent = currentRun.persistent;
        resultPromise.then((result: unknown) => { // Loaded successfully
            loadCall.result = result;
            persistent.loadCalls.push(loadCall); // Should not modify it asynchronously. Will be buggy if rerender is triggered in the meanwhile. TODO: implement third case: Can re-use but still loading
        });

        resultPromise.catch((reason) => {
            throw reason;
            // TODO: set component to error state
        })

        throw resultPromise; // Throwing a promise will put the react component into suspense state
    }
}

/**
 * graph.createProxyFor(props) errors when props's readonly properties are accessed.
 * So instead, this functions does not proxy the **whole** props but each prop individually
 * @param graph
 * @param props
 */
function createProxyForProps<P extends object>(graph: WatchedGraph, props: P): P {
    // TODO: see ShouldReLoadIfPropsPropertyChanges.
    const result = {}
    Object.keys(props).forEach(key => {
        //@ts-ignore
        const value = props[key];
        Object.defineProperty(result, key,  {
            value: (value!= null && typeof value === "object")?graph.getProxyFor(value):value,
            writable: false
        })
    })
    return result as P;
}