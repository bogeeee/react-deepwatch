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

class RenderRun {
    protected doReRender: () => void

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

    cleanedUp = false;

    cleanUpFns: (()=>void)[] = [];
    cleanUp() {
        this.cleanUpFns.forEach(c => c()); // Clean the listeners
        this.cleanedUp = true;
    }

    /**
     * A changed dependency can also be a loading value that just finished loading
     */
    handleChangedDependency() {
        if(this.cleanedUp) {
            throw new Error("Illegal state: This render run has already be cleaned up. There must not be any more listeners left that call here.");
        }
        this.cleanUp();
        this.doReRender();
    }

    constructor(persistent: WatchedComponentPersistent, reRender: () => void) {
        this.persistent = persistent
        this.doReRender = reRender;
    }
}
let currentRenderRun: RenderRun| undefined;

export function WatchedComponent<PROPS extends object>(componentFn:(props: PROPS) => any) {
    return (props: PROPS) => {
        const [renderCounter, setRenderCounter] = useState(0);
        const [persistent] = useState(new WatchedComponentPersistent());

        // Create RenderRun:
        currentRenderRun === undefined || throwError("Illegal state: already in currentRenderRun");
        const renderRun = currentRenderRun = new RenderRun(persistent, () => setRenderCounter(renderCounter+1));

        try {
            const watchedProps = createProxyForProps(renderRun.watchedGraph, props);

            // Install read listener:
            let readListener = (read: RecordedRead)  => {
                // Re-render on a change of the read value:
                const changeListener = (newValue: unknown) => {
                    if(currentRenderRun) {
                        throw new Error("You must not modify a watched object during the render run.");
                    }
                    renderRun.handleChangedDependency();
                }
                read.onChange(changeListener);
                renderRun.cleanUpFns.push(() => read.offChange(changeListener)); // Cleanup on re-render
                renderRun.recordedReads.push(read);
            };
            renderRun.watchedGraph.onAfterRead(readListener)

            try {
                return componentFn(watchedProps); // Run the user's component function
            }
            catch (e) {
                if(e instanceof Promise) { // TODO: better check / better signal
                    // Quick and dirty handle the suspense ourself. Cause the react Suspense does not restore the state by useState :(
                    e.then(result => {renderRun.handleChangedDependency()})
                    return "...loading..."; // TODO: return loader
                }
                else {
                    throw e;
                }
            }
            finally {
                renderRun.watchedGraph.offAfterRead(readListener);
            }
        }
        finally {
            renderRun.recordedReads = []; // renderRun is still referenced in closures, but this field is not needed, so let's not hold a big grown array here and may be prevent memory leaks
            currentRenderRun = undefined;
        }
    }
}

function useWatched<T extends object>(obj: T): T {
    currentRenderRun || throwError("useWatched is not used from inside a WatchedComponent");
    return currentRenderRun!.watchedGraph.getProxyFor(obj);
}

export function useWatchedState(initial: object) {
    currentRenderRun || throwError("useWatchedState is not used from inside a WatchedComponent");

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
    if(currentRenderRun === undefined) throw new Error("load is not used from inside a WatchedComponent")

    const renderRun = currentRenderRun;

    const loadCallIndex = renderRun.loadCallIndex;

    /**
     * Can we use the result from previous / last call ?
     */
    function canReusePreviousResult() {
        if(!(loadCallIndex < renderRun.persistent.loadCalls.length)) { // call was not recorded previously ?
            return false;
        }
        const previousLoadCall = renderRun.persistent.loadCalls[loadCallIndex];

        if(!recordedReadsArraysAreEqual(renderRun.recordedReads, previousLoadCall.recordedReadsBefore)) {
            return false;
        }

        if(previousLoadCall.recordedReadsInsideLoaderFn.some((r => r.isChanged))) { // I.e for "load( () => { fetch(props.x, myLocalValue) }) )" -> props.x or myLocalValue has changed?
            return false;
        }

        return true;
    }

    if(canReusePreviousResult()) {
        const previousCall = renderRun.persistent.loadCalls[loadCallIndex];
        renderRun.recordedReads = [];
        renderRun.loadCallIndex++;

        previousCall.recordedReadsInsideLoaderFn.forEach(read => {
            // Re-render on a change of the read value:
            const changeListener = (newValue: unknown) => {
                if(currentRenderRun) {
                    throw new Error("You must not modify a watched object during the render run.");
                }
                renderRun.handleChangedDependency();
            }
            read.onChange(changeListener);
            renderRun.cleanUpFns.push(() => read.offChange(changeListener)); // Cleanup on re-render
        })

        // return proxy'ed result from previous call:
        let result = previousCall.result
        if(result !== null && typeof result === "object") {
            result = renderRun.watchedGraph.getProxyFor(result); // Record the reads inside the result as well
        }
        return result as T;
    }
    // TODO: introduce third case. Can re-use but still loading
    else { // cannot use previous result ?
        // *** make a call / exec loaderFn ***:

        renderRun.persistent.loadCalls = renderRun.persistent.loadCalls.slice(0, loadCallIndex); // Erase all snaphotted loadCalls after here (including this one). They can't be re-used because they might also depend on the result of this call (+ eventually if a property changed till here)

        let loadCall = new RecordedLoadCall();
        loadCall.recordedReadsBefore = renderRun.recordedReads; renderRun.recordedReads = []; // pop and remember the reads so far before the loaderFn
        const resultPromise = Promise.resolve(loaderFn()); // Exec loaderFn
        loadCall.recordedReadsInsideLoaderFn = renderRun.recordedReads;  renderRun.recordedReads = []; // pop and remember the (immediate) reads from inside the loaderFn

        const persistent = renderRun.persistent;
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