import {RecordedRead, recordedReadsArraysAreEqual, RecordedValueRead, WatchedGraph} from "./watchedGraph";
import {arraysAreEqualsByPredicateFn, PromiseState, throwError} from "./Util";
import {useLayoutEffect, useState, createElement, Fragment, ReactNode, useEffect, useContext} from "react";
import {ErrorBoundaryContext, useErrorBoundary} from "react-error-boundary";
import {ProxiedGraph} from "./proxiedGraph";

export {debug_numberOfPropertyChangeListeners} from "./watchedGraph"; // TODO: Remove before release

let watchedGraph: WatchedGraph | undefined

type WatchedComponentOptions = {
    /**
     * A fallback react tree to show when some `load(...)` statement in <strong>this</strong> component is loading.
     * Use this if you have issues with screen flickering with <code><Suspense></code>.
     */
    fallback?: ReactNode,

    /**
     * Everything that's **taken** from props, {@link useWatchedState} or {@link watched} will be returned, wrapped in a proxy that watches for modifications.
     * So far, so good, this can handle all stuff that's happening inside your component, but the outside world does not have these proxies. For example, the parent component, that passed in an object (i.e. the model) into this component via props.
     * Therefore this component can also **patch** these objects to make them watchable. I.e. it defines setters for properties or replaces the push method for an array instance.
     *
     *
     * <p>Default: true</p>
     */
    watchExternalModifications?: boolean
}

class RecordedLoadCall {
    /**
     * From the beginning or previous load call up to this one
     */
    recordedReadsBefore!: RecordedRead[];
    recordedReadsInsideLoaderFn!: RecordedRead[];

    result!: PromiseState<unknown>;
    name?: string;
}

/**
 * Fields that persist across re-render and across frames
 */
class WatchedComponentPersistent {
    loadCalls: RecordedLoadCall[] = [];

    currentFrame?: Frame

    /**
     * RenderRun: A passive render is requested. Save reference to the render run a safety check
     */
    reRenderRequested: boolean | RenderRun = false;

    _doReRender!: () => void

    debug_tag?: string;

    protected doReRender() {
        // Call listeners:
        this.onBeforeReRenderListeners.forEach(fn => fn());
        this.onBeforeReRenderListeners = [];

        this._doReRender()
    }

    requestReRender(passiveFromRenderRun?: RenderRun) {
        const wasAlreadyRequested = this.reRenderRequested !== false;

        // Enable the reRenderRequested flag:
        if(passiveFromRenderRun !== undefined && this.reRenderRequested !== true) {
            this.reRenderRequested = passiveFromRenderRun;
        }
        else {
            this.reRenderRequested = true;
        }

        if(wasAlreadyRequested) {
            return;
        }

        // Do the re-render:
        if(currentRenderRun !== undefined) {
            // Must defer it because we cannot call rerender from inside a render function
            setTimeout(() => {
                this.doReRender();
            })
        }
        else {
            this.doReRender();
        }
    }

    /**
     * When a load finished or finished with error, or when a watched value changed. So the component needs to be rerendered
     */
    handleChangeEvent() {
        this.currentFrame!.dismissErrorBoundary?.();
        this.requestReRender();
    }

    hadASuccessfullMount = false;

    onBeforeReRenderListeners: (()=>void)[] = [];
}

/**
 *
 * Lifecycle: Render + optional passive render + timespan until the next render (=because something new happened) or complete unmount.
 * Note: In case of an error and wrapped in a recoverable <ErrorBoundary>, the may not even be a mount but this Frame still exist.
 *
 */
class Frame {
    /**
     * Result or result so far.
     * - RenderRun, when component is currently rendering or beeing displayed (also for passive runs, if the passive run had that outcome)
     * - undefined, when component was unmounted (and nothing was thrown / not loading)
     * - Promise, when something is loading (with no fallback, etc) and therefore the component is in suspense (also for passive runs, if the passive run had that outcome)
     * - Error when error was thrown during last render (also for passive runs, if the passive run had that outcome)
     * - unknown: Something else was thrown during last render (also for passive runs, if the passive run had that outcome)
     */
    result!: RenderRun | undefined | Promise<unknown> | Error | unknown;

    /**
     * The most recent render run
     */
    recentRenderRun?: RenderRun;

    persistent!: WatchedComponentPersistent;

    /**
     * See {@link https://github.com/bvaughn/react-error-boundary?tab=readme-ov-file#dismiss-the-nearest-error-boundary}
     * From optional package.
     */
    dismissErrorBoundary?: () => void;

    //watchedGraph= new WatchedGraph();
    get watchedGraph() {
        // Use a global shared instance. Because there's no exclusive state inside the graph/handlers. And state.someObj = state.someObj does not cause us multiple nesting layers of proxies. Still this may not the final choice. When changing this mind also the `this.proxyHandler === other.proxyHandler` in RecordedPropertyRead#equals
        return watchedGraph || (watchedGraph = new WatchedGraph()); // Lazy initialize global variable
    }

    startPropChangeListeningFns: (()=>void)[] = [];
    startListeningForPropertyChanges() {
        this.startPropChangeListeningFns.forEach(c => c()); // Clean the listeners
    }

    cleanUpPropChangeListenerFns: (()=>void)[] = [];
    stopListeningForPropertyChanges() {
        this.cleanUpPropChangeListenerFns.forEach(c => c()); // Clean the listeners
    }

    handleWatchedPropertyChange() {
        this.persistent.handleChangeEvent();
    }

    watchPropertyChange(read: RecordedRead) {
        // Re-render on a change of the read value:
        const changeListener = (newValue: unknown) => {
            if (currentRenderRun) {
                throw new Error("You must not modify a watched object during the render run.");
            }
            this.handleWatchedPropertyChange();
        }
        this.startPropChangeListeningFns.push(() => read.onChange(changeListener));
        this.cleanUpPropChangeListenerFns.push(() => read.offChange(changeListener));
    }
}

/**
 * Lifecycle: Starts when rendering and ends when unmounting or re-rendering the WatchedComponent.
 * - References to this can still exist when WatchedComponentPersistent is in a resumeable error state (is this a good idea? )
 */
class RenderRun {
    frame!: Frame;

    isPassive=false;

    /**
     * Set when isLoading or someError is called.
     * Note: Looks to be redundant to WatchedComponentPersistent#nextRenderIsPassive on the first view, but it's safer to set this here and keep the other one very short-lived, because who knows what concurrent re-renders will fire when and are then run falsely passive.
     */
    needsAnotherPassiveRender=false;

    recordedReads: RecordedRead[] = [];


    /**
     * Increased, when we see a load(...) call
     */
    loadCallIndex = 0;

    /**
     * Cache of persistent.loadCalls.some(l => l.result.state === "pending")
     */
    somePending?: Promise<unknown>;
    somePendingAreCritical = false;

    /**
     * Body of useEffect
     */
    handleEffectSetup() {
        this.frame.persistent.hadASuccessfullMount = true;
        this.frame.startListeningForPropertyChanges();
    }

    /**
     * Called by useEffect before the next render oder before unmount(for suspense, for error or forever)
     */
    handleEffectCleanup() {
        if(this.frame.result instanceof Error && this.frame.dismissErrorBoundary !== undefined) { // Error is displayed ?
            // Still listen for property changes to be able to recover from errors
            this.frame.persistent.onBeforeReRenderListeners.push(() => {this.frame.stopListeningForPropertyChanges()}); //Instead clean up listeners on next render
        }
        else {
            this.frame.stopListeningForPropertyChanges(); // Clean up now
        }
    }
}
let currentRenderRun: RenderRun| undefined;

export function WatchedComponent<PROPS extends object>(componentFn:(props: PROPS) => any, options: WatchedComponentOptions = {}) {
    return (props: PROPS) => {
        const [renderCounter, setRenderCounter] = useState(0);
        const [persistent] = useState(new WatchedComponentPersistent());
        persistent._doReRender = () => setRenderCounter(renderCounter+1);

        const isPassive = persistent.currentFrame?.recentRenderRun !== undefined && persistent.reRenderRequested === persistent.currentFrame.recentRenderRun; // Set that flag very shy, so another render run in the meanwhile or a non-passive rerender request will dominate
        persistent.reRenderRequested = false;
        
        // Create frame:
        let frame = isPassive && persistent.currentFrame !== undefined ? persistent.currentFrame : new Frame();
        persistent.currentFrame = frame;
        frame.persistent = persistent;

        // Create RenderRun:
        currentRenderRun === undefined || throwError("Illegal state: already in currentRenderRun");
        const renderRun = currentRenderRun = new RenderRun();
        renderRun.frame = frame;
        renderRun.isPassive = isPassive;
        frame.recentRenderRun = currentRenderRun;


        // Register dismissErrorBoundary function:
        if(typeof useErrorBoundary === "function") { // Optional package was loaded?
            if(useContext(ErrorBoundaryContext)) { // Inside an error boundary?
                frame.dismissErrorBoundary = useErrorBoundary().resetBoundary;
            }
        }

        useEffect(() => {
            renderRun.handleEffectSetup();
            return () => renderRun.handleEffectCleanup();
        });


        try {
            const watchedProps = createProxyForProps(frame.watchedGraph, props);

            // Install read listener:
            let readListener = (read: RecordedRead)  => {
                if(!renderRun.isPassive) { // Active run ?
                    frame.watchPropertyChange(read);
                }

                renderRun.recordedReads.push(read);
            };
            frame.watchedGraph.onAfterRead(readListener)

            try {
                return componentFn(watchedProps); // Run the user's component function
            }
            catch (e) {
                if(renderRun.needsAnotherPassiveRender) {
                    return createElement(Fragment, null); // Don't go to suspense **now**. The passive render might have a different outcome. (rerender will be done, see "finally")
                }

                frame.result = e;
                if(e instanceof Promise) {
                    if(!persistent.hadASuccessfullMount) {
                        // Handle the suspense ourself. Cause the react Suspense does not restore the state by useState :(
                        e.finally(() => {persistent.handleChangeEvent()})
                        return createElement(Fragment, null); // Return an empty element (might cause a short screen flicker) and render again.
                    }

                    if(options.fallback) {
                        e.finally(() => {persistent.handleChangeEvent()})
                        return options.fallback;
                    }

                    // React's <Suspense> seems to keep this component mounted (hidden), so here's no need for an artificial renderRun.startListeningForPropertyChanges();
                }
                else { // Error?
                    if(frame.dismissErrorBoundary !== undefined) { // inside  (recoverable) error boundary ?
                        // The useEffects won't fire, so whe simulate the frame's effect lifecycle here:
                        frame.startListeningForPropertyChanges();
                        persistent.onBeforeReRenderListeners.push(() => {
                            frame.stopListeningForPropertyChanges()
                        });
                    }
                }
                throw e;
            }
            finally {
                frame.watchedGraph.offAfterRead(readListener);
            }
        }
        finally {
            renderRun.recordedReads = []; // renderRun is still referenced in closures, but this field is not needed, so let's not hold a big grown array here and may be prevent memory leaks
            currentRenderRun = undefined;

            //Safety check:
            (renderRun.isPassive && renderRun.needsAnotherPassiveRender) && throwError("Illegal state");
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
    return currentRenderRun!.frame.watchedGraph.getProxyFor(obj);
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

type LoadOptions = {
    /**
     * If you specify a fallback, the component can be immediately rendered during loading.
     * <p>
     * undefined = undefined as fallback.
     * </p>
     */
    fallback?: unknown

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

    /**
     * {@link isLoading} Can filter for only the load(...) statements with this given name.
     */
    name?: string
}
export function load<T,FALLBACK>(loaderFn: () => Promise<T>, options?: Omit<LoadOptions, "fallback">): T
export function load<T,FALLBACK>(loaderFn: () => Promise<T>, options: LoadOptions & {fallback: FALLBACK}): T | FALLBACK
export function load(loaderFn: () => Promise<unknown>, options: LoadOptions = {}): any {
    // Wording:
    // - "previous" means: load(...) statements more upwards in the user's code
    // - "last" means: this load call but from a past frame

    // Validity checks:
    typeof loaderFn === "function" || throwError("loaderFn is not a function");
    if(currentRenderRun === undefined) throw new Error("load is not used from inside a WatchedComponent")

    const hasFallback = options.hasOwnProperty("fallback");
    const renderRun = currentRenderRun;
    const frame = renderRun.frame
    const persistent = frame.persistent;
    const recordedReadsSincePreviousLoadCall = renderRun.recordedReads; renderRun.recordedReads = []; // Pop recordedReads
    let lastLoadCall = renderRun.loadCallIndex < persistent.loadCalls.length?persistent.loadCalls[renderRun.loadCallIndex]:undefined;

    try {
        if(renderRun.isPassive) {
            // Don't look at recorded reads. Assume the order has not changed

            // Validity check:
            if(lastLoadCall === undefined) {
                //throw new Error("More load(...) statements in render run for status indication seen than last time. isLoading()'s result must not influence the structure/order of load(...) statements.");
                // you can still get here when there was a some critical pending load before this, that had sliced off the rest. TODO: don't slice and just mark them as invalid

                if(hasFallback) {
                    return options.fallback;
                }
                else {
                    throw new Error(`When using isLoading(), you must specify fallbacks for all your load statements:  load(..., {fallback: some-fallback-value})`);
                }
            }

            //** return lastLoadCall.result:
            if(lastLoadCall.result.state === "resolved") {
                return watched(lastLoadCall.result.resolvedValue);
            }
            else if(lastLoadCall?.result.state === "rejected") {
                throw lastLoadCall.result.rejectReason;
            }
            else if(lastLoadCall.result.state === "pending") {
                if(hasFallback) {
                    return options.fallback;
                }
                throw lastLoadCall.result.promise;
            }
            else {
                throw new Error("Unhandled state");
            }
        }

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
        const recordedReadsAreEqualSinceLastCall = lastLoadCall && recordedReadsArraysAreEqual(recordedReadsSincePreviousLoadCall, lastLoadCall.recordedReadsBefore)
        if(!recordedReadsAreEqualSinceLastCall) {
            persistent.loadCalls = persistent.loadCalls.slice(0, renderRun.loadCallIndex); // Erase all snaphotted loadCalls after here (including this one).
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
                if (hasFallback) { // Fallback specified ?
                    return {result: options.fallback};
                }

                lastLoadCall.recordedReadsInsideLoaderFn.forEach(read => frame.watchPropertyChange(read)) // Also watch recordedReadsInsideLoaderFn (again in this frame)
                throw lastLoadCall.result.promise; // Throwing a promise will put the react component into suspense state
            } else if (lastLoadCall.result.state === "rejected") {
                lastLoadCall.recordedReadsInsideLoaderFn.forEach(read => frame.watchPropertyChange(read)) // Also watch recordedReadsInsideLoaderFn (again in this frame)
                throw lastLoadCall.result.rejectReason;
            } else {
                throw new Error("Invalid state of lastLoadCall.result.state")
            }
        }

        const canReuse = canReuseLastResult();
        if (canReuse !== false) { // can re-use ?
            const lastCall = persistent.loadCalls[renderRun.loadCallIndex];

            lastCall.recordedReadsInsideLoaderFn.forEach(read => frame.watchPropertyChange(read)) // Also watch recordedReadsInsideLoaderFn

            return canReuse.result; // return proxy'ed result from last call:
        }
        else { // cannot use last result ?
            if(renderRun.somePending && renderRun.somePendingAreCritical) { // Performance: Some previous (and dependent) results are pending, so loading this one would trigger a reload soon
                // don't make a new call
                if(hasFallback) {
                    return options.fallback!;
                }
                else {
                    throw renderRun.somePending;
                }
            }

            // *** make a loadCall / exec loaderFn ***:

            let loadCall = new RecordedLoadCall();
            loadCall.name = options.name;
            loadCall.recordedReadsBefore = recordedReadsSincePreviousLoadCall;
            const resultPromise = Promise.resolve(loaderFn()); // Exec loaderFn
            loadCall.recordedReadsInsideLoaderFn = renderRun.recordedReads; renderRun.recordedReads = []; // pop and remember the (immediate) reads from inside the loaderFn

            resultPromise.then((value) => {
                loadCall.result = {state: "resolved", resolvedValue: value}
            })
            resultPromise.catch(reason => {
                loadCall.result = {state: "rejected", rejectReason: reason}
            })
            loadCall.result = {state: "pending", promise: resultPromise};

            persistent.loadCalls[renderRun.loadCallIndex] = loadCall; // add / replace

            renderRun.somePending = resultPromise;
            renderRun.somePendingAreCritical ||= (options.critical !== false);

            if (hasFallback) { // Fallback specified ?
                loadCall.result.promise.then((result) => {
                    if(result === null || (!(typeof result === "object")) && result === options.fallback) { // Result is primitive and same as fallback ?
                        // Loaded value did not change / No re-render needed because the fallback is already displayed
                    }
                    else {
                        persistent.handleChangeEvent();
                    }
                })
                loadCall.result.promise.catch((error) => {
                    persistent.handleChangeEvent(); // Re-render. The next render will see state=rejected for this load statement and throw it then.
                })
                return options.fallback!;
            }

            throw resultPromise; // Throwing a promise will put the react component into suspense state
        }
    }

    function watched(value: unknown) { return (value !== null && typeof value === "object")?frame.watchedGraph.getProxyFor(value):value }
}

/**
 * Probe if a <code>load(...)</code> statement directly inside this watchedComponent is currently loading.
 * Note: It's mostly needed to also specify a {@link LoadOptions#fallback} in the load statement's options to produce a valid render result while loading. Otherwise the whole component goes into suspense.
 * <p>
 * Caveat: You must not use this for a condition that cuts away a load(...) statement in the middle of your render code. This is because an extra render run is issued for isLoading() and the load(...) statements are re-matched by their order.
 * </p>
 * @param nameFilter When set, consider only those with the given {@link LoadOptions#name}. I.e. <code>load(..., {name: "myDropdownListEntries"})</code>
 *
 */
export function isLoading(nameFilter?: string): boolean {
    // Validity check:
    if(currentRenderRun === undefined) throw new Error("load is not used from inside a WatchedComponent")

    if(currentRenderRun.isPassive) {
        return currentRenderRun.frame.persistent.loadCalls.some(c => c.result.state === "pending" && (!nameFilter || c.name === nameFilter));
    }
    currentRenderRun.needsAnotherPassiveRender = true;
    currentRenderRun.frame.persistent.requestReRender(currentRenderRun) // Request passive render.
    return false;
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

export function debug_tagComponent(name: string) {
    currentRenderRun!.frame.persistent.debug_tag = name;
}