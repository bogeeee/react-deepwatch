import {RecordedRead, recordedReadsArraysAreEqual, RecordedValueRead, WatchedGraph} from "./watchedGraph";
import {arraysAreEqualsByPredicateFn, PromiseState, throwError} from "./Util";
import {useLayoutEffect, useState, createElement, Fragment} from "react";
import {ProxiedGraph} from "./proxiedGraph";

let watchedGraph: WatchedGraph | undefined

type WatchedComponentOptions = {

    /**
     * Everything that's **taken** from props, {@link useWatchedState} or {@link watched} will be returned, wrapped in a proxy that watches for modifications.
     * So far, so good, this can handle all stuff that's happening inside your component, but the outside world does not have these proxies. For example, the parent component, that passed in an object (i.e. the model) into this component via props.
     * Therefore this component can also **patch** these objects to make them watchable. I.e. it defines setters for properties or replaces the push method for an array instance.
     *
     *
     * <p>Default: true</p>
     */
    watchExternalModifications: boolean
}

class RecordedLoadCall {
    /**
     * From the beginning or previous load call up to this one
     */
    recordedReadsBefore!: RecordedRead[];
    recordedReadsInsideLoaderFn!: RecordedRead[];

    result!: PromiseState<unknown>;
}

/**
 * Fields that persist across re-render
 */
class WatchedComponentPersistent {
    loadCalls: RecordedLoadCall[] = [];
    doReRender!: () => void
    /**
     * RenderRun, when component is currently rendering or beeing displayed
     * Promise, when something is loading and component is in suspense
     * Error when errored
     */
    state!: RenderRun | Promise<unknown> | Error;
    hadASuccessfullMount = false;

    handleLoadingFinished() {
        if(this.state instanceof RenderRun) {
            this.state.cleanUp();
            this.doReRender();
        }
        else {
            this.doReRender();
        }
    }
}

class RenderRun {

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

    /**
     * Cache of persistent.loadCalls.some(l => l.result.state === "pending")
     */
    somePending?: Promise<unknown>;
    somePendingAreCritical = false;

    cleanedUp = false;

    cleanUpFns: (()=>void)[] = [];

    cleanUp() {
        this.cleanUpFns.forEach(c => c()); // Clean the listeners
        this.cleanedUp = true;
    }

    handleWatchedPropertyChange() {
        if(this.cleanedUp) {
            throw new Error("Illegal state: This render run has already be cleaned up. There must not be any more listeners left that call here.");
        }
        this.cleanUp();
        this.persistent.doReRender();
    }

    constructor(persistent: WatchedComponentPersistent) {
        this.persistent = persistent
    }
}
let currentRenderRun: RenderRun| undefined;

export function WatchedComponent<PROPS extends object>(componentFn:(props: PROPS) => any) {
    return (props: PROPS) => {
        const [renderCounter, setRenderCounter] = useState(0);
        const [persistent] = useState(new WatchedComponentPersistent());
        persistent.doReRender = () => setRenderCounter(renderCounter+1);
        useLayoutEffect(() => {
            persistent.hadASuccessfullMount = true;
        });

        // Create RenderRun:
        currentRenderRun === undefined || throwError("Illegal state: already in currentRenderRun");
        const renderRun = currentRenderRun = new RenderRun(persistent);

        try {
            const watchedProps = createProxyForProps(renderRun.watchedGraph, props);

            // Install read listener:
            let readListener = (read: RecordedRead)  => {
                // Re-render on a change of the read value:
                const changeListener = (newValue: unknown) => {
                    if(currentRenderRun) {
                        throw new Error("You must not modify a watched object during the render run.");
                    }
                    renderRun.handleWatchedPropertyChange();
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
                renderRun.cleanUp();
                if(e instanceof Promise) {
                    persistent.state = e;
                    // Quick and dirty handle the suspense ourself. Cause the react Suspense does not restore the state by useState :(
                    e.then(result => {persistent.handleLoadingFinished()})
                    if(!persistent.hadASuccessfullMount) {
                        return createElement(Fragment, null); // Return an empty element (might cause a short screen flicker) an render again.
                    }
                    throw e;
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

type WatchedOptions = {
    /**
     * TODO: Implement
     * Called, when a deep property was changed through the proxy.
     */
    onChange: () => void

    /**
     * TODO: Implement
     * Called on a change to one of those properties, that were read-recorded in the component function (through the proxy of course).
     * Reacts also on external changes / not done through the proxy.
     */
    onRecorededChange: () => void
}

function watched<T extends object>(obj: T, options?: WatchedOptions): T {
    currentRenderRun || throwError("watched is not used from inside a WatchedComponent");
    return currentRenderRun!.watchedGraph.getProxyFor(obj);
}

export function useWatchedState(initial: object, options?: WatchedOptions) {
    currentRenderRun || throwError("useWatchedState is not used from inside a WatchedComponent");

    const [state]  = useState(initial);
    return watched(state);
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

type LoadOptions<T> = {
    /**
     * If you specify a placeholder, the component can be immediately rendered during loading.
     * <p>
     * undefined = undefined as placeholder.
     * </p>
     */
    placeHolder?: T

    /**
     * Performance: Set to false, to mark following `load(...)` statements do not depend on the result. I.e when used only for immediate rendering or passed to child components only. I.e. <div>{load(...)}/div> or `<MySubComponent param={load(...)} />`:
     * Therefore, the following `load(...)` statements may not need a reload and can run in parallel.
     * <p>
     *     Default: true
     *  </p>
     */
    critical?: boolean

    // Seems not possible because loaderFn is mostly an anonymous function and cannot be re-identified
    // /**
    //  * Values which the loaderFn depends on. If any of these change, it will do a reload.
    //  * <p>
    //  *     By default it will do a very safe and comfortable in-doubt-do-a-reload, meaning: It depends on the props + all `usedWatchedState(...)` + all `watched(...)` + the result of previous `load(...)` statements.
    //  * </p>
    //  */
    // deps?: unknown[]

    /**
     * Poll after this amount of milliseconds
     */
    poll?: number
}

export function load<T>(loaderFn: () => Promise<T>, options: LoadOptions<T> = {}): T {
    // Wording:
    // - "previous" means: load(...) statements more upwards in the user's code
    // - "last" means: this load call but from a past render run.

    // Validity checks:
    typeof loaderFn === "function" || throwError("loaderFn is not a function");
    if(currentRenderRun === undefined) throw new Error("load is not used from inside a WatchedComponent")

    const hasPlaceHolder = options.hasOwnProperty("placeHolder");
    const renderRun = currentRenderRun;
    const recordedReadsSincePreviousLoadCall = renderRun.recordedReads; renderRun.recordedReads = []; // Pop recordedReads

    try {
        let result = inner();
        if(options.critical !== false) {
            renderRun.recordedReads.push(new RecordedValueRead(result)); // Add as dependency for the next loads
        }
        return watched(result);
    }
    finally {
        renderRun.loadCallIndex++;
    }



    function inner()  {
        let lastLoadCall = renderRun.loadCallIndex < renderRun.persistent.loadCalls.length?renderRun.persistent.loadCalls[renderRun.loadCallIndex]:undefined;
        const recordedReadsAreEqualSinceLastCall = lastLoadCall && recordedReadsArraysAreEqual(recordedReadsSincePreviousLoadCall, lastLoadCall.recordedReadsBefore)
        if(!recordedReadsAreEqualSinceLastCall) {
            renderRun.persistent.loadCalls = renderRun.persistent.loadCalls.slice(0, renderRun.loadCallIndex); // Erase all snaphotted loadCalls after here (including this one).
            lastLoadCall = undefined;
        }

        /**
         * Can we use the result from last call ?
         */
        const canReuseLastResult = () => {
            if(!lastLoadCall) { // call was not recorded last render or is invalid?
                return false;
            }
            if (!recordedReadsAreEqualSinceLastCall) {
                return false;
            }

            if (lastLoadCall.recordedReadsInsideLoaderFn.some((r => r.isChanged))) { // I.e for "load( () => { fetch(props.x, myLocalValue) }) )" -> props.x or myLocalValue has changed?
                return false;
            }

            if (lastLoadCall.result.state === "resolved") {
                return {result: lastLoadCall.result.resolvedValue}
            }
            if (lastLoadCall.result.state === "pending") {
                renderRun.somePending = lastLoadCall.result.promise;
                renderRun.somePendingAreCritical ||= (options.critical !== false);
                if (hasPlaceHolder) { // Placeholder specified ?
                    return {result: options.placeHolder};
                }
                throw lastLoadCall.result.promise; // Throwing a promise will put the react component into suspense state
            } else if (lastLoadCall.result.state === "rejected") {
                return false; // Try again
            } else {
                throw new Error("Invalid state of lastLoadCall.result.state")
            }
        }

        const canReuse = canReuseLastResult();
        if (canReuse !== false) { // can re-use ?
            const lastCall = renderRun.persistent.loadCalls[renderRun.loadCallIndex];

            lastCall.recordedReadsInsideLoaderFn.forEach(read => {
                // Re-render on a change of the read value:
                const changeListener = (newValue: unknown) => {
                    if (currentRenderRun) {
                        throw new Error("You must not modify a watched object during the render run.");
                    }
                    renderRun.handleWatchedPropertyChange();
                }
                read.onChange(changeListener);
                renderRun.cleanUpFns.push(() => read.offChange(changeListener)); // Cleanup on re-render
            })

            return canReuse.result as T; // return proxy'ed result from last call:
        }
        else { // cannot use last result ?
            if(renderRun.somePending && renderRun.somePendingAreCritical) { // Performance: Some previous (and dependent) results are pending, so loading this one would trigger a reload soon
                // don't make a new call
                if(hasPlaceHolder) {
                    return options.placeHolder!;
                }
                else {
                    throw renderRun.somePending;
                }
            }

            // *** make a loadCall / exec loaderFn ***:

            let loadCall = new RecordedLoadCall();
            loadCall.recordedReadsBefore = recordedReadsSincePreviousLoadCall;
            const resultPromise = Promise.resolve(loaderFn()); // Exec loaderFn
            loadCall.recordedReadsInsideLoaderFn = renderRun.recordedReads; renderRun.recordedReads = []; // pop and remember the (immediate) reads from inside the loaderFn

            resultPromise.then((value) => {
                loadCall.result = {state: "resolved", resolvedValue: value}
            })
            resultPromise.catch(reason => {
                loadCall.result = {state: "rejected", rejectReason: reason}
                // TODO: set component to error state
            })
            loadCall.result = {state: "pending", promise: resultPromise};

            renderRun.persistent.loadCalls[renderRun.loadCallIndex] = loadCall; // add / replace

            renderRun.somePending = resultPromise;
            renderRun.somePendingAreCritical ||= (options.critical !== false);

            if (hasPlaceHolder) { // Placeholder specified ?
                loadCall.result.promise.then((result) => {
                    if(result === null || (!(typeof result === "object")) && result === options.placeHolder) { // Result is primitive and same as placeholder ?
                        // Do nothing because the placeholder is already displayed
                    }
                    else {
                        renderRun.persistent.handleLoadingFinished();
                    }
                })
                return options.placeHolder!;
            }

            throw resultPromise; // Throwing a promise will put the react component into suspense state
        }
    }

    function watched(value: T) { return (value !== null && typeof value === "object")?renderRun.watchedGraph.getProxyFor(value):value }
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