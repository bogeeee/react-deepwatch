import {
    RecordedRead,
    RecordedReadOnProxiedObject,
    recordedReadsArraysAreEqual,
    RecordedValueRead,
    WatchedGraph
} from "./watchedGraph";
import {arraysAreEqualsByPredicateFn, PromiseState, throwError} from "./Util";
import {useLayoutEffect, useState, createElement, Fragment, ReactNode, useEffect, useContext, memo} from "react";
import {ErrorBoundaryContext, useErrorBoundary} from "react-error-boundary";
import {enhanceWithWriteTracker} from "./globalWriteTracking";
import {_preserve, preserve, PreserveOptions} from "./preserve";

export {debug_numberOfPropertyChangeListeners} from "./watchedGraph"; // TODO: Remove before release

let watchedGraph: WatchedGraph | undefined
function getWatchedGraph() {
    return watchedGraph || (watchedGraph = new WatchedGraph()); // Lazy initialize global variable
}

let debug_idGenerator=0;

type WatchedComponentOptions = {
    /**
     * A fallback react tree to show when some `load(...)` statement in <strong>this</strong> component is loading.
     * Use this if you have issues with screen flickering with <code><Suspense></code>.
     */
    fallback?: ReactNode,

    /**
     * Wraps this component in a {@link https://react.dev/reference/react/memo memo} to prevent unnecessary re-renders.
     * This is enabled by default, since watchedComponents smartly tracks deep changes of used props and knows when to rerender.
     * Disable this only in a mixed scenario with non-watchedComponents, where they rely on the old way of fully re-rendering the whole tree to pass deep model data (=more than using shallow, primitive props) to the leaves. So this component does not block these re-renders in the middle.
     * <p>
     *   Default: true
     * </p>
     */
    memo?: boolean

    /**
     * TODO
     * Normally, everything that's **taken** from props, {@link useWatchedState} or {@link watched} or load(...)'s result will be returned, wrapped in a proxy that watches for modifications.
     * So far, so good, this can handle all stuff that's happening inside your component, but the outside world does not have these proxies. For example, when a parent component is not a watchedComponent, and passed in an object (i.e. the model) into this component via props.
     * Therefore this component can also **patch** these objects to make them watchable.
     *
     *
     * <p>Default: true</p>
     */
    watchOutside?: boolean

    /**
     * TODO: implement
     * Preserves object instances in props by running the {@link preserve} function over the props (where the last value is memoized).
     * <p>
     * It's not recommended to enable this. Use only as a workaround when working with non-watched components where you have no control over. Better run {@link preserve} on the fetched source and keep a consistent-instance model in your app in the first place.
     * </p>
     *
     * Note: Even with false, the `props` root object still keeps its instance (so it's save to watch `props.myFirstLevelProperty`).
     * <p>
     *     Default: false
     * </p>
     */
    preserveProps?: boolean
}

class RecordedLoadCall {
    debug_id = ++debug_idGenerator;
    /**
     * Back reference to it
     */
    watchedComponentPersistent: WatchedComponentPersistent;

    /**
     * Reference saved only for polling
     */
    loaderFn?: (oldResult?: unknown) => Promise<unknown>;

    options!: LoadOptions & Partial<PollOptions>;

    /**
     * From the beginning or previous load call up to this one
     */
    recordedReadsBefore!: RecordedRead[];
    recordedReadsInsideLoaderFn!: RecordedRead[];

    result!: PromiseState<unknown>;

    lastExecTime?: Date;

    /**
     * Result from setTimeout.
     * Set, when re-polling is scheduled or running (=the loaderFn is re-running)
     */
    rePollTimer?: any;

    /**
     * index in this.watchedComponentPersistent.loadCalls
     */
    cache_index: number;

    diagnosis_callstack?: Error

    get isObsolete() {
        return !(this.watchedComponentPersistent.loadCalls.length > this.cache_index && this.watchedComponentPersistent.loadCalls[this.cache_index] === this); // this.watchedComponentPersistent.loadCalls does not contain this?
    }


    get name() {
        return this.options.name;
    }

    async exec() {
        try {
            if(this.options.fixedInterval !== false) this.lastExecTime = new Date(); // Take timestamp
            const lastResult = this.result?.state === "resolved"?this.result.resolvedValue:undefined;
            let result = await this.loaderFn!(lastResult);
            if(lastResult !== undefined && this.options.preserve !== false) { // Preserve enabled?
                const preserveOptions = (typeof this.options.preserve === "object")?this.options.preserve: {};
                result = _preserve(lastResult,result, preserveOptions, {callStack: this.diagnosis_callstack});
            }
            return result
        }
        finally {
            if(this.options.fixedInterval === false) this.lastExecTime = new Date(); // Take timestamp
        }
    }

    activateRegularRePollingIfNeeded() {
        // Check, if we should really schedule:
        this.checkValid();
        if(!this.options.interval) { // Polling not enabled ?
            return;
        }
        if(this.rePollTimer !== undefined) { // Already scheduled ?
            return;
        }
        if(this.isObsolete) {
            return;
        }
        if(this.result.state === "pending") {
            return; // will call activateRegularRePollingIfNeeded() when load is finished and a rerender is done
        }

        this.rePollTimer = setTimeout(async () => {
            // Check, if we should really execute:
            this.checkValid();
            if (this.rePollTimer === undefined) { // Not scheduled anymore / frame not alive?
                return;
            }
            if (this.isObsolete) {
                return;
            }

            await this.executeRePoll();

            // Now that some time may have passed, check, again, if we should really schedule the next poll:
            this.checkValid();
            if (this.rePollTimer === undefined) { // Not scheduled anymore / frame not alive?
                return;
            }
            if (this.isObsolete) {
                return;
            }

            // Re-schedule
            clearTimeout(this.rePollTimer); // Call this to make sure...May be polling has been activated and deactivated in the manwhile during executeRePoll and this.rePollTimer is now another one
            this.rePollTimer = undefined;
            this.activateRegularRePollingIfNeeded();
        },  Math.max(0, this.options.interval - (new Date().getTime() - this.lastExecTime!.getTime())) );
    }

    /**
     * Re runs loaderFn
     */
    async executeRePoll() {
        try {
            const value = await this.exec();
            const isUnchangedPrimitiveValue = this.result.state === "resolved" && (value === null || (!(typeof value === "object"))) && value === this.result.resolvedValue;
            this.result = {state: "resolved", resolvedValue:value}

            if(this.isObsolete) {
                return;
            }

            if (isUnchangedPrimitiveValue) {
                // Loaded value did not change / No re-render needed because the fallback is already displayed
            } else {
                this.watchedComponentPersistent.handleChangeEvent();
            }
        }
        catch (e) {
            this.result = {state: "rejected", rejectReason: e};
            if(!this.isObsolete) {
                this.watchedComponentPersistent.handleChangeEvent();
            }
        }
    }

    deactivateRegularRePoll() {
        this.checkValid();
        if(this.rePollTimer !== undefined) {
            clearTimeout(this.rePollTimer);
            this.rePollTimer = undefined;
        }
    }

    checkValid() {
        if(this.rePollTimer !== undefined && this.result.state === "pending") {
            throw new Error("Illegal state");
        }
    }


    constructor(watchedComponentPersistent: WatchedComponentPersistent, loaderFn: (() => Promise<unknown>) | undefined, options: LoadOptions & Partial<PollOptions>, cache_index: number, diagnosis_callStack: Error | undefined) {
        this.watchedComponentPersistent = watchedComponentPersistent;
        this.loaderFn = loaderFn;
        this.options = options;
        this.cache_index = cache_index;
        this.diagnosis_callstack = diagnosis_callStack;
    }
}

/**
 * Fields that persist across re-render and across frames
 */
class WatchedComponentPersistent {
    options: WatchedComponentOptions;

    /**
     * props of the component. These are saved here in the state (in a non changing object instance), so code inside load call can watch **shallow** props changes on it.
     */
    watchedProps = getWatchedGraph().getProxyFor({});

    loadCalls: RecordedLoadCall[] = [];

    currentFrame?: Frame

    /**
     * - true = rerender requested (will re-render asap) or just starting the render and changes in props/state/watched still make it into it.
     * - false = ...
     * - RenderRun = A passive render is requested. Save reference to the render run as safety check
     */
    reRenderRequested: boolean | RenderRun = false;

    _doReRender!: () => void

    hadASuccessfullMount = false;

    /**
     * Called either before or on the render
     */
    onceOnReRenderListeners: (()=>void)[] = [];

    onceOnEffectCleanupListeners: (()=>void)[] = [];

    debug_tag?: string;

    protected doReRender() {
        // Call listeners:
        this.onceOnReRenderListeners.forEach(fn => fn());
        this.onceOnReRenderListeners = [];

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

    /**
     * @returns boolean it looks like ... (passive is very shy) unless another render run in the meanwhile or a non-passive rerender request will dominate
     */
    nextReRenderMightBePassive() {
        return this.currentFrame?.recentRenderRun !== undefined && this.reRenderRequested === this.currentFrame.recentRenderRun;
    }


    constructor(options: WatchedComponentOptions) {
        this.options = options;
    }

    /**
     *
     * @param props
     */
    applyNewProps(props: object) {
        // Set / add new props:
        for(const key in props) {
            //@ts-ignore
            this.watchedProps[key] = props[key];
        }

        // Set non-existing to undefined:
        for(const key in this.watchedProps) {
            //@ts-ignore
            this.watchedProps[key] = props[key];
        }
    }
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

    isListeningForChanges = false;

    //watchedGraph= new WatchedGraph();
    get watchedGraph() {
        // Use a global shared instance. Because there's no exclusive state inside the graph/handlers. And state.someObj = state.someObj does not cause us multiple nesting layers of proxies. Still this may not the final choice. When changing this mind also the `this.proxyHandler === other.proxyHandler` in RecordedPropertyRead#equals
        return getWatchedGraph();
    }

    constructor() {
        this.watchPropertyChange_changeListenerFn = this.watchPropertyChange_changeListenerFn.bind(this); // method is handed over as function but uses "this" inside.
    }

    startPropChangeListeningFns: (()=>void)[] = [];
    /**
     * Makes the frame become "alive". Listens for property changes and re-polls poll(...) statements.
     * Calling it twice does not hurt.
     */
    startListeningForChanges() {
        if(this.isListeningForChanges) {
            return;
        }

        this.startPropChangeListeningFns.forEach(c => c());

        this.persistent.loadCalls.forEach(lc => lc.activateRegularRePollingIfNeeded()); // Schedule re-polls

        this.isListeningForChanges = true;
    }

    cleanUpPropChangeListenerFns: (()=>void)[] = [];

    /**
     * @see startListeningForChanges
     * @param deactivateRegularRePoll keep this true normally.
     */
    stopListeningForChanges(deactivateRegularRePoll=true) {
        if(!this.isListeningForChanges) {
            return;
        }

        this.cleanUpPropChangeListenerFns.forEach(c => c()); // Clean the listeners
        if(deactivateRegularRePoll) {
            this.persistent.loadCalls.forEach(lc => lc.deactivateRegularRePoll()); // Stop scheduled re-polls
        }

        this.isListeningForChanges = false;
    }

    handleWatchedPropertyChange() {
        this.persistent.handleChangeEvent();
    }

    watchPropertyChange(read: RecordedRead) {
        //Diagnosis: Provoke errors early, cause the code at the bottom of this method looses the stacktrace to the user's jsx
        if(this.persistent.options.watchOutside !== false) {
            try {
                if (read instanceof RecordedReadOnProxiedObject) {
                    enhanceWithWriteTracker(read.obj);
                }
            }
            catch (e) {
                throw new Error(`Could not enhance the original object to track reads. This can fail, if it was created with some unsupported language constructs (defining read only properties; subclassing Array, Set or Map; ...). You can switch it off via the WatchedComponentOptions#watchOutside flag. I.e: const MyComponent = watchedComponent(props => {...}, {watchOutside: false})`, {cause: e});
            }
        }

        // Re-render on a change of the read value:
        this.startPropChangeListeningFns.push(() => read.onChange(this.watchPropertyChange_changeListenerFn /* Performance: We're not using an anonymous(=instance-changing) function here */, this.persistent.options.watchOutside !== false));
        this.cleanUpPropChangeListenerFns.push(() => read.offChange(this.watchPropertyChange_changeListenerFn /* Performance: We're not using an anonymous(=instance-changing) function here */));
    }

    protected watchPropertyChange_changeListenerFn(newValue: unknown) {
        if (currentRenderRun) {
            throw new Error("You must not modify a watched object during the render run.");
        }
        this.handleWatchedPropertyChange();
    }
}

/**
 * Lifecycle: Starts when rendering and ends when unmounting or re-rendering the watchedComponent.
 * - References to this can still exist when WatchedComponentPersistent is in a resumeable error state (is this a good idea? )
 */
class RenderRun {
    frame!: Frame;

    isPassive=false;

    recordedReads: RecordedRead[] = [];


    /**
     * Increased, when we see a load(...) call
     */
    loadCallIndex = 0;

    onFinallyAfterUsersComponentFnListeners: (()=>void)[] = [];

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
        this.frame.startListeningForChanges();
    }

    /**
     * Called by useEffect before the next render oder before unmount(for suspense, for error or forever)
     */
    handleEffectCleanup() {
        // Call listeners:
        this.frame.persistent.onceOnEffectCleanupListeners.forEach(fn => fn());
        this.frame.persistent.onceOnEffectCleanupListeners = [];

        let currentFrame = this.frame.persistent.currentFrame!;
        if(currentFrame.result instanceof Error && currentFrame.dismissErrorBoundary !== undefined) { // Error is displayed ?
            // Still listen for property changes to be able to recover from errors and clean up later:
            if(this.frame !== currentFrame) { // this.frame is old ?
                this.frame.stopListeningForChanges(false); // This frame's listeners can be cleaned now but still keep the polling alive (there's a conflict with double responsibility here / hacky solution)
            }
            this.frame.persistent.onceOnReRenderListeners.push(() => {
                this.frame.stopListeningForChanges();
                this.frame.persistent.loadCalls.forEach(lc => lc.deactivateRegularRePoll()); // hacky solution2: The lines above have propably skipped this, so do it now
            }); //Instead clean up listeners next time
        }
        else {
            this.frame.stopListeningForChanges(); // Clean up now
        }
    }
}
let currentRenderRun: RenderRun| undefined;

export function watchedComponent<PROPS extends object>(componentFn:(props: PROPS) => any, options: WatchedComponentOptions = {}) {
    const outerResult = (props: PROPS) => {
        const [renderCounter, setRenderCounter] = useState(0);
        const [persistent] = useState(new WatchedComponentPersistent(options));
        persistent._doReRender = () => setRenderCounter(renderCounter+1);

        const isPassive = persistent.nextReRenderMightBePassive()

        // Apply the new props (may trigger change listeners and therefore requestReRender() )
        persistent.reRenderRequested = true; // this prevents new re-renders
        persistent.requestReRender(); // Test, that this does not cause an infinite loop. (line can be removed when running stable)
        persistent.applyNewProps(props);

        persistent.reRenderRequested = false;

        // Call remaining listeners, because may be the render was not "requested" through code in this package but happened some other way:
        persistent.onceOnReRenderListeners.forEach(fn => fn());
        persistent.onceOnReRenderListeners = [];
        
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
            // Install read listener:
            let readListener = (read: RecordedRead)  => {
                if(!renderRun.isPassive) { // Active run ?
                    frame.watchPropertyChange(read);
                }

                renderRun.recordedReads.push(read);
            };
            frame.watchedGraph.onAfterRead(readListener)

            try {
                try {
                    return componentFn(persistent.watchedProps as PROPS); // Run the user's component function
                }
                finally {
                    renderRun.onFinallyAfterUsersComponentFnListeners.forEach(l => l()); // Call listeners
                }
            }
            catch (e) {
                if(persistent.nextReRenderMightBePassive()) {
                    return createElement(Fragment, null); // Don't go to suspense **now**. The passive render might have a different outcome. (rerender will be done, see "finally")
                }

                frame.result = e;
                if(e instanceof Promise) {
                    if(!persistent.hadASuccessfullMount) {
                        // Handle the suspense ourself. Cause the react Suspense does not restore the state by useState :(
                        return createElement(Fragment, null); // Return an empty element (might cause a short screen flicker) and render again.
                    }

                    if(options.fallback) {
                        return options.fallback;
                    }

                    // React's <Suspense> seems to keep this component mounted (hidden), so here's no need for an artificial renderRun.startListeningForChanges();
                }
                else { // Error?
                    if(frame.dismissErrorBoundary !== undefined) { // inside  (recoverable) error boundary ?
                        // The useEffects won't fire, so whe simulate the frame's effect lifecycle here:
                        frame.startListeningForChanges();
                        persistent.onceOnReRenderListeners.push(() => {frame.stopListeningForChanges()});
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
        }
    }

    if (options.memo === false) {
        return outerResult;
    }

    return memo(outerResult);
}

type WatchedOptions = {
    /**
     * TODO: Implement
     * Called, when a deep property was changed through the proxy.
     */
    onChange?: () => void

    /**
     * TODO: Implement
     * Called on a change to one of those properties, that were read-recorded in the component function (through the proxy of course).
     * Reacts also on external changes / not done through the proxy.
     */
    onRecordedChange?: () => void
}

function watched<T extends object>(obj: T, options?: WatchedOptions): T {
    currentRenderRun || throwError("watched is not used from inside a watchedComponent");
    return currentRenderRun!.frame.watchedGraph.getProxyFor(obj);
}

export function useWatchedState(initial: object, options?: WatchedOptions) {
    currentRenderRun || throwError("useWatchedState is not used from inside a watchedComponent");

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

    /**
     *
     * <p>Default: true</p>
     */
    preserve?: boolean | PreserveOptions
}
type PollOptions = {
    /**
     * Interval in milliseconds
     */
    interval: number

    /**
     * - true = interval means loaderFn-start to loaderFn-start
     * - false = interval means loaderFn-end to loaderFn-start (the longer loaderFn takes, the more time till next re-poll)
     * <p>
     * Default: true
     * </p>
     */
    fixedInterval?:boolean
}

/**
 * Runs the async loaderFn and re-renders, if its promise was resolved. Also re-renders and re-runs loaderFn, when some of its watched dependencies, used prior or instantly in the loaderFn, change.
 * Puts the component into suspense while loading. Throws an error when loaderFn throws an error or its promise is rejected. Resumes from react-error-boundary automatically when loaderFn was re-run(because of the above).
 * <p>
 * {@link https://github.com/bogeeee/react-deepwatch#and-less-loading-code Usage}.
 * </p>
 * @param loaderFn
 * @param options
 */
export function load<T,FALLBACK>(loaderFn: (oldResult?: T) => Promise<T>, options?: Omit<LoadOptions, "fallback">): T
/**
 * Runs the async loaderFn and re-renders, if its promise was resolved. Also re-renders and re-runs loaderFn, when some of its watched dependencies, used prior or instantly in the loaderFn, change.
 * Puts the component into suspense while loading. Throws an error when loaderFn throws an error or its promise is rejected. Resumes from react-error-boundary automatically when loaderFn was re-run(because of the above).
 * <p>
 * {@link https://github.com/bogeeee/react-deepwatch#and-less-loading-code Usage}.
 * </p>
 * @param loaderFn
 * @param options
 */
export function load<T,FALLBACK>(loaderFn: (oldResult?: T) => Promise<T>, options: LoadOptions & {fallback: FALLBACK}): T | FALLBACK
/**
 * Runs the async loaderFn and re-renders, if its promise was resolved. Also re-renders and re-runs loaderFn, when some of its watched dependencies, used prior or instantly in the loaderFn, change.
 * Puts the component into suspense while loading. Throws an error when loaderFn throws an error or its promise is rejected. Resumes from react-error-boundary automatically when loaderFn was re-run(because of the above).
 * <p>
 * {@link https://github.com/bogeeee/react-deepwatch#and-less-loading-code Usage}.
 * </p>
 * @param loaderFn
 * @param options
 */
export function load(loaderFn: (oldResult?: unknown) => Promise<unknown>, options: LoadOptions & Partial<PollOptions> = {}): any {
    const diagnosis_callStack = options.preserve !== false?new Error("load(...) was called"):undefined // Look one level up, where you called load(...)

    // Wording:
    // - "previous" means: load(...) statements more upwards in the user's code
    // - "last" means: this load call but from a past frame

    // Validity checks:
    typeof loaderFn === "function" || throwError("loaderFn is not a function");
    if(currentRenderRun === undefined) throw new Error("load is not used from inside a watchedComponent")

    const hasFallback = options.hasOwnProperty("fallback");
    const renderRun = currentRenderRun;
    const frame = renderRun.frame
    const persistent = frame.persistent;
    const recordedReadsSincePreviousLoadCall = renderRun.recordedReads; renderRun.recordedReads = []; // Pop recordedReads
    let lastLoadCall = renderRun.loadCallIndex < persistent.loadCalls.length?persistent.loadCalls[renderRun.loadCallIndex]:undefined;
    if(lastLoadCall) {
        lastLoadCall.loaderFn = options.interval ? loaderFn : undefined; // only needed, when polling.
        lastLoadCall.options = options; // Update options. It is allowed that these can change over time. I.e. the poll interval or the name.
    }

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

            let loadCall = new RecordedLoadCall(persistent, loaderFn, options, renderRun.loadCallIndex, diagnosis_callStack);
            loadCall.recordedReadsBefore = recordedReadsSincePreviousLoadCall;
            const resultPromise = Promise.resolve(loadCall.exec()); // Exec loaderFn
            loadCall.loaderFn = options.interval?loadCall.loaderFn:undefined; // Remove reference if not needed to not risk leaking memory
            loadCall.recordedReadsInsideLoaderFn = renderRun.recordedReads; renderRun.recordedReads = []; // pop and remember the (immediate) reads from inside the loaderFn

            resultPromise.then((value) => {
                loadCall.result = {state: "resolved", resolvedValue: value};

                if(loadCall.isObsolete) {
                    return;
                }

                if (hasFallback && (value === null || (!(typeof value === "object")) && value === options.fallback)) { // Result is primitive and same as fallback ?
                    // Loaded value did not change / No re-render needed because the fallback is already displayed
                    if(persistent.currentFrame?.isListeningForChanges) { // Frame is "alive" ?
                        loadCall.activateRegularRePollingIfNeeded();
                    }
                } else {
                        persistent.handleChangeEvent(); // Will also do a rerender and call activateRegularRePollingIfNeeded, like above
                }
            });
            resultPromise.catch(reason => {
                loadCall.result = {state: "rejected", rejectReason: reason}

                if(loadCall.isObsolete) {
                    return;
                }

                persistent.handleChangeEvent(); // Re-render. The next render will see state=rejected for this load statement and throw it then.
            })
            loadCall.result = {state: "pending", promise: resultPromise};

            persistent.loadCalls[renderRun.loadCallIndex] = loadCall; // add / replace

            renderRun.somePending = resultPromise;
            renderRun.somePendingAreCritical ||= (options.critical !== false);

            if (hasFallback) {
                return options.fallback!;
            } else {
                throw resultPromise; // Throwing a promise will put the react component into suspense state
            }
        }
    }

    function watched(value: unknown) { return (value !== null && typeof value === "object")?frame.watchedGraph.getProxyFor(value):value }
}

/**
 * Probe if a <code>load(...)</code> statement directly inside this watchedComponent is currently loading.
 * Note: It's mostly needed to also specify a {@link LoadOptions#fallback} in the load statement's options to produce a valid render result while loading. Otherwise the whole component goes into suspense.
 * <p>
 * Example. This uses isLoading() to determine if the Dropdown list should be faded/transparent during while items are loading:
 * <pre><code>
 *     return  <select style={{opacity: isLoading("dropdownItems")?0.5:1}}>
 *                 {load(() => fetchMyDropdownItems(), {name: "dropdownItems", fallback: ["loading items"]}).map(i => <option value="{i}">{i}</option>)}
 *     </select>
 * </code></pre>
 * </p>
 * <p>
 * Caveat: You must not use this for a condition that cuts away a load(...) statement in the middle of your render code. This is because an extra render run is issued for isLoading() and the load(...) statements are re-matched by their order.
 * </p>
 * @param nameFilter When set, consider only those with the given {@link LoadOptions#name}. I.e. <code>load(..., {name: "myDropdownListEntries"})</code>
 *
 */
export function isLoading(nameFilter?: string): boolean {
    const renderRun = currentRenderRun;
    // Validity check:
    if(renderRun === undefined) throw new Error("isLoading is not used from inside a watchedComponent")

    return probe(() => renderRun.frame.persistent.loadCalls.some(c => c.result.state === "pending" && (!nameFilter || c.name === nameFilter)), false);
}

/**
 * Probe if a <code>load(...)</code> statement directly inside this watchedComponent failed.
 * <p>
 * Example:
 * <pre><code>
 *     if(loadFailed()) {
 *          return <div>Load failed: {loadFailed().message}</div>;
 *     }
 *
 *     return <div>My component content {load(...)} </div>
 * </code></pre>
 * </p>
 * <p>
 * Caveat: You must not use this for a condition that cuts away a load(...) statement in the middle of your render code. This is because an extra render run is issued for loadFailed() and the load(...) statements are re-matched by their order.
 * </p>
 * @param nameFilter When set, consider only those with the given {@link LoadOptions#name}. I.e. <code>load(..., {name: "myDropdownListEntries"})</code>
 * @returns unknown The thrown value of the loaderFn or undefined if everything is ok.
 */
export function loadFailed(nameFilter?: string): unknown {
    const renderRun = currentRenderRun;
    // Validity check:
    if(renderRun === undefined) throw new Error("isLoading is not used from inside a watchedComponent")

    return probe(() => {
        return (renderRun.frame.persistent.loadCalls.find(c => c.result.state === "rejected" && (!nameFilter || c.name === nameFilter))?.result as any)?.rejectReason;
    }, undefined);
}

/**
 * Like {@link load}, but re-runs loaderFn regularly at the interval, specified in the options.
 * <p>
 * Example: <code>return <div>The current outside temperature is {  poll( async () => await fetchTemperatureFromServer(), {interval: 1000} )  }° </div></code> *
 * </p>
 * <p>
 * Polling is still continued in recoverable error cases, when
 * </p>
 *  - loaderFn fails but your watchedComponent catches it and returns fine.
 *  - Your watchedComponent returns with an error(because of this loaderFn or some other reason) and it is wrapped in a react-error-boundary.
 *
 * <p>
 *     Note, that after the initial load, re-polling is done <strong>very silently</strong>. Meaning, there's no suspense / fallback / isLoading indicator involved.
 * </p>
 * @param loaderFn
 * @param options
 */
export function poll<T,FALLBACK>(loaderFn: (oldResult?: T) => Promise<T>, options: Omit<LoadOptions, "fallback"> & PollOptions): T
/**
 * Like {@link load}, but re-runs loaderFn regularly at the interval, specified in the options.
 * <p>
 * Example: <code>return <div>The current outside temperature is {  async poll( await () => fetchTemperatureFromServer(), {interval: 1000} )  }° </div></code> *
 * </p>
 * <p>
 * Polling is still continued in recoverable error cases, when
 * </p>
 *  - loaderFn fails but your watchedComponent catches it and returns fine.
 *  - Your watchedComponent returns with an error(because of this loaderFn or some other reason) and it is wrapped in a react-error-boundary.
 *
 * <p>
 *     Note, that after the initial load, re-polling is done <strong>very silently</strong>. Meaning, there's no suspense / fallback / isLoading indicator involved.
 * </p>
 * @param loaderFn
 * @param options
 */
export function poll<T,FALLBACK>(loaderFn: (oldResult?: T) => Promise<T>, options: LoadOptions & {fallback: FALLBACK} & PollOptions): T | FALLBACK
/**
 * Like {@link load}, but re-runs loaderFn regularly at the interval, specified in the options.
 * <p>
 * Example: <code>return <div>The current outside temperature is {  poll( async () => await fetchTemperatureFromServer(), {interval: 1000} )  }° </div></code> *
 * </p>
 * <p>
 * Polling is still continued in recoverable error cases, when
 * </p>
 *  - loaderFn fails but your watchedComponent catches it and returns fine.
 *  - Your watchedComponent returns with an error(because of this loaderFn or some other reason) and it is wrapped in a react-error-boundary.
 *
 * <p>
 *     Note, that after the initial load, re-polling is done <strong>very silently</strong>. Meaning, there's no suspense / fallback / isLoading indicator involved.
 * </p>
 * @param loaderFn
 * @param options
 */
export function poll(loaderFn: (oldResult?: unknown) => Promise<unknown>, options: LoadOptions & PollOptions): any {
    return load(loaderFn, options);
}

/**
 * For isLoading and isError. Makes a passive render run if these a
 * @param probeFn
 * @param defaultResult
 */
function probe<T>(probeFn: () => T, defaultResult: T) {
    const renderRun = currentRenderRun;
    // Validity check:
    if(renderRun === undefined) throw new Error("Not used from inside a watchedComponent")

    if(renderRun.isPassive) {
        return probeFn();
    }

    renderRun.onFinallyAfterUsersComponentFnListeners.push(() => {
        if(probeFn() !== defaultResult) {
            renderRun.frame.persistent.requestReRender(currentRenderRun) // Request passive render.
        }
    })

    return defaultResult;
}


export function debug_tagComponent(name: string) {
    currentRenderRun!.frame.persistent.debug_tag = name;
}