import {
    RecordedRead,
    RecordedReadOnProxiedObject,
    RecordedValueRead,
    WatchedProxyFacade
} from "proxy-facades";
import {arraysAreEqualsByPredicateFn, isObject, PromiseState, throwError} from "./Util";
import {useLayoutEffect, useState, createElement, Fragment, ReactNode, useEffect, useContext, memo} from "react";
import {ErrorBoundaryContext, useErrorBoundary} from "react-error-boundary";
import {enhanceWithWriteTracker} from "./globalWriteTracking";
import {_preserve, preserve, PreserveOptions} from "./preserve";

export {debug_numberOfPropertyChangeListeners} from "./watchedProxyFacade"; // TODO: Remove before release

let watchedProxyFacade: WatchedProxyFacade | undefined
function getWatchedProxyFacade() {
    return watchedProxyFacade || (watchedProxyFacade = new WatchedProxyFacade()); // Lazy initialize global variable
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

/**
 * Contains the preconditions and the state / polling state for a load(...) statement.
 * Very volatile. Will be invalid as soon as a precondition changes, or if it's not used or currently not reachable (in that case there will spawn another LoadRun).
 */
class LoadRun {
    debug_id = ++debug_idGenerator;

    loadCall: LoadCall


    /**
     * Reference may be forgotten, when not needed for re-polling
     */
    loaderFn?: (oldResult?: unknown) => Promise<unknown>;


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
     * index in this.watchedComponentPersistent.loadRuns
     */
    cache_index: number;


    get isObsolete() {
        return !(this.loadCall.watchedComponentPersistent.loadRuns.length > this.cache_index && this.loadCall.watchedComponentPersistent.loadRuns[this.cache_index] === this); // this.watchedComponentPersistent.loadRuns does not contain this?
    }

    get options() {
        return this.loadCall.options;
    }

    get name() {
        return this.options.name;
    }

    async exec() {
        try {
            if(this.options.fixedInterval !== false) this.lastExecTime = new Date(); // Take timestamp
            const lastResult = this.loadCall.lastResult;
            let result = await this.loaderFn!(lastResult);
            if(this.options.preserve !== false) { // Preserve enabled?
                if(isObject(result)) { // Result is mergeable ?
                    this.loadCall.isUniquelyIdentified() || throwError(new Error(`Please specify a key via load(..., { key:<your key> }), so the result's object identity can be preserved. See LoadOptions#key and LoadOptions#preserve. Look at the cause to see where load(...) was called`, {cause: this.loadCall.diagnosis_callstack}));
                    const preserveOptions = (typeof this.options.preserve === "object")?this.options.preserve: {};
                    result = _preserve(lastResult,result, preserveOptions, {callStack: this.loadCall.diagnosis_callstack});
                }
            }

            // Save lastresult:
            if(this.options.preserve !== false || this.options.silent) { // last result will be needed later?
                this.loadCall.lastResult = result; // save for later
            }
            else {
                // Be memory friendly and don't leak references.
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
            const isChanged = !(this.result.state === "resolved" && value === this.result.resolvedValue)
            this.result = {state: "resolved", resolvedValue:value}

            if(this.isObsolete) {
                return;
            }

            if(isChanged) {
                this.loadCall.watchedComponentPersistent.handleChangeEvent(); // requests a re-render
                return;
            }
            if(this.options.critical === false && isObject(value)) {
                this.loadCall.watchedComponentPersistent.requestReRender(); // Non-critical objects are not watched. But their deep changed content is used in the render. I.e. <div>{ load(() => {return {msg: `counter: ...`}}, {critical:false}).msg }</div>
                return;
            }
        }
        catch (e) {
            this.result = {state: "rejected", rejectReason: e};
            if(!this.isObsolete) {
                this.loadCall.watchedComponentPersistent.handleChangeEvent();
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


    constructor(loadCall: LoadCall, loaderFn: LoadRun["loaderFn"], cache_index: number) {
        this.loadCall = loadCall;
        this.loaderFn = loaderFn;
        this.cache_index = cache_index;
    }
}

/**
 * Uniquely identifies a call, to remember the lastResult to preserve object instances
 */
class LoadCall {
    /**
     * Unique id. (Source can be determined through the call stack), or, if run in a loop, it must be specified by the user
     */
    id?: string | number | object;

    /**
     * Back reference to it
     */
    watchedComponentPersistent: WatchedComponentPersistent;

    /**
     *
     */
    options!: LoadOptions & Partial<PollOptions>;

    /**
     * Fore preserving
     */
    lastResult: unknown


    diagnosis_callstack?: Error
    diagnosis_callerSourceLocation?: string

    constructor(id: LoadCall["id"], watchedComponentPersistent: WatchedComponentPersistent, options: LoadOptions & Partial<PollOptions>, diagnosis_callStack: Error | undefined, diagnosis_callerSourceLocation: string | undefined) {
        this.id = id;
        this.watchedComponentPersistent = watchedComponentPersistent;
        this.options = options;
        this.diagnosis_callstack = diagnosis_callStack;
        this.diagnosis_callerSourceLocation = diagnosis_callerSourceLocation
    }

    isUniquelyIdentified() {
        let registeredForId = this.watchedComponentPersistent.loadCalls.get(this.id);
        if(registeredForId === undefined) {
            throw new Error("Illegal state: No Load call for this id was registered");
        }
        if(registeredForId === null) {
            return false; // Null means: Not unique
        }
        if(registeredForId !== this) {
            throw new Error("Illegal state: A different load call for this id was registered.");
        }
        return true;
    }

    /**
     * Value from the {@link LoadOptions#fallback} or through the {@link LoadOptions#silent} mechanism.
     * Undefined, when no such "fallback" is available
     */
    getFallbackValue(): {value: unknown} | undefined {
        !(this.options.silent && !this.isUniquelyIdentified()) || throwError(`Please specify a key via load(..., { key:<your key> }), to allow LoadOptions#silent to re-identify the last result. See LoadOptions#key and LoadOptions#silent.`); // Validity check

        if(this.options.silent && this.lastResult !== undefined) {
            return {value: this.lastResult}
        }
        else if(this.options.hasOwnProperty("fallback")) {
            return {value: this.options.fallback};
        }
        return undefined;
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
    watchedProps = getWatchedProxyFacade().getProxyFor({});

    /**
     * id -> loadCall. Null when there are multiple for that id
     */
    loadCalls = new Map<LoadCall["id"], LoadCall | null>();

    /**
     * LoadRuns in the exact order, they occur
     */
    loadRuns: LoadRun[] = [];

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
 * Lifecycle: Render + optional passive render + timespan until the next render (=because something new happened) or until the final unmount.
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

    //watchedProxyFacade= new WatchedProxyFacade();
    get watchedProxyFacade() {
        // Use a global shared instance. Because there's no exclusive state inside the graph/handlers. And state.someObj = state.someObj does not cause us multiple nesting layers of proxies. Still this may not the final choice. When changing this mind also the `this.proxyHandler === other.proxyHandler` in RecordedPropertyRead#equals
        return getWatchedProxyFacade();
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

        this.persistent.loadRuns.forEach(lc => lc.activateRegularRePollingIfNeeded()); // Schedule re-polls

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
            this.persistent.loadRuns.forEach(lc => lc.deactivateRegularRePoll()); // Stop scheduled re-polls
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

    protected watchPropertyChange_changeListenerFn() {
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

    loadCallIdsSeen = new Set<LoadCall["id"]>();

    /**
     * Increased, when we see a load(...) call
     */
    loadCallIndex = 0;

    onFinallyAfterUsersComponentFnListeners: (()=>void)[] = [];

    /**
     * Cache of persistent.loadRuns.some(l => l.result.state === "pending")
     */
    somePending?: Promise<unknown>;
    somePendingAreCritical = false;

    handleRenderFinishedSuccessfully() {
        if(!this.isPassive) {
            // Delete unused loadCalls
            const keys = [...this.frame.persistent.loadCalls.keys()];
            keys.forEach(key => {
                if (!this.loadCallIdsSeen.has(key)) {
                    this.frame.persistent.loadCalls.delete(key);
                }
            })

            // Delete unused loadRuns:
            this.frame.persistent.loadRuns = this.frame.persistent.loadRuns.slice(0, this.loadCallIndex+1);
        }
    }

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
                this.frame.persistent.loadRuns.forEach(lc => lc.deactivateRegularRePoll()); // hacky solution2: The lines above have propably skipped this, so do it now
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
            frame.watchedProxyFacade.onAfterRead(readListener)

            try {
                try {
                    let result = componentFn(persistent.watchedProps as PROPS);  // Run the user's component function
                    renderRun.handleRenderFinishedSuccessfully();
                    return result;
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
                frame.watchedProxyFacade.offAfterRead(readListener);
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
    return currentRenderRun!.frame.watchedProxyFacade.getProxyFor(obj);
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
     * For {@link LoadOptions#preserve preserving} the result's object identity.
     * Normally, this is obtained from the call stack information plus the {@link LoadOptions#key}.
     *
     * @see LoadOptions#key
     */
    id?: string | number | object

    /**
     * Helps identifying the load(...) call from inside a loop for {@link LoadOptions#preserve preserving} the result's object identity.
     * @see LoadOptions#id
     */
    key?: string | number

    /**
     * If you specify a fallback, the component can be immediately rendered during loading.
     * <p>
     * undefined = undefined as fallback.
     * </p>
     */
    fallback?: unknown

    /**
     * Performance: Will return the old value from a previous load, while this is still loading. This causes less disturbance (i.e. triggering dependent loads) while switching back to the fallback and then to a real value again.
     * <p>Best used in combination with {@link isLoading} and {@link fallback}</p>
     * <p>Default: false</p>
     */
    silent?: boolean

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
    const callStack = new Error("load(...) was called") // Look not here, but one level down in the stack, where you called load(...)

    // Wording:
    // - "previous" means: load(...) statements more upwards in the user's code
    // - "last" means: this load call but from a past frame

    // Validity checks:
    typeof loaderFn === "function" || throwError("loaderFn is not a function");
    if(currentRenderRun === undefined) throw new Error("load is not used from inside a watchedComponent")

    const renderRun = currentRenderRun;
    const frame = renderRun.frame
    const persistent = frame.persistent;
    const recordedReadsSincePreviousLoadCall = renderRun.recordedReads; renderRun.recordedReads = []; // Pop recordedReads
    const callerSourceLocation = callStack.stack ? getCallerSourceLocation(callStack.stack) : undefined;

    // Determine loadCallId:
    let loadCallId: LoadCall["id"] | undefined
    if(options.id !== undefined) {
        options.key === undefined || throwError("Must not set both: LoadOptions#id and LoadOptions#key"); // Validity check

        loadCallId = options.id;

        !renderRun.loadCallIdsSeen.has(loadCallId) || throwError(`LoadOptions#id=${loadCallId} is not unique`);
    } else if (options.key !== undefined) {
        callerSourceLocation || throwError("No callstack available to compose the id. Please specify LoadOptions#id instead of LoadOptions#key"); // validity check
        loadCallId = `${callerSourceLocation}___${options.key}` // I.e. ...
        !renderRun.loadCallIdsSeen.has(loadCallId) || throwError(`LoadOptions#key=${options.key} is used multiple times / is not unique here.`);
    } else {
        loadCallId = callerSourceLocation; // from source location only
    }
    const isUnique = !(renderRun.loadCallIdsSeen.has(loadCallId) || persistent.loadCalls.get(loadCallId) === null);
    renderRun.loadCallIdsSeen.add(loadCallId);

    // Find the loadCall or create it:
    let loadCall: LoadCall | undefined
    if(isUnique) {
        loadCall = persistent.loadCalls.get(loadCallId) as (LoadCall | undefined);
    }
    if(loadCall === undefined) {
        loadCall = new LoadCall(loadCallId, persistent, options, callStack, callerSourceLocation);
    }
    persistent.loadCalls.set(loadCallId, isUnique?loadCall:null);

    loadCall.options = options; // Update options. It is allowed that these can change over time. I.e. the poll interval or the name.

    // Determine lastLoadRun:
    let lastLoadRun = renderRun.loadCallIndex < persistent.loadRuns.length?persistent.loadRuns[renderRun.loadCallIndex]:undefined;
    if(lastLoadRun) {
        lastLoadRun.loaderFn = options.interval ? loaderFn : undefined; // Update. only needed, when polling.
        lastLoadRun.loadCall.id === loadCall.id || throwError(new Error("Illegal state: lastLoadRun associated with different LoadCall. Please make sure that you don't use non-`watched(...)` inputs (useState, useContext) in your watchedComponent. " + `. Debug info: Ids: ${lastLoadRun.loadCall.id} vs. ${loadCall.id}. See cause for falsely associcated loadCall.`, {cause: lastLoadRun.loadCall.diagnosis_callstack})); // Validity check
    }

    const fallback = loadCall.getFallbackValue();

    try {
        if(renderRun.isPassive) {
            // Don't look at recorded reads. Assume the order has not changed

            // Validity check:
            if(lastLoadRun === undefined) {
                //throw new Error("More load(...) statements in render run for status indication seen than last time. isLoading()'s result must not influence the structure/order of load(...) statements.");
                // you can still get here when there was a some critical pending load before this, that had sliced off the rest. TODO: don't slice and just mark them as invalid

                if(fallback) {
                    return fallback.value;
                }
                else {
                    throw new Error(`When using isLoading(), you must specify fallbacks for all your load statements:  load(..., {fallback: some-fallback-value})`);
                }
            }

            //** return lastLoadRun.result:
            if(lastLoadRun.result.state === "resolved") {
                return options.critical !== false?watched(lastLoadRun.result.resolvedValue):lastLoadRun.result.resolvedValue;
            }
            else if(lastLoadRun?.result.state === "rejected") {
                throw lastLoadRun.result.rejectReason;
            }
            else if(lastLoadRun.result.state === "pending") {
                if(fallback) {
                    return fallback.value;
                }
                throw lastLoadRun.result.promise;
            }
            else {
                throw new Error("Unhandled state");
            }
        }

        let result = inner();
        if(options.critical === false) {
            return result; // non-watched and add no dependency
        }
        renderRun.recordedReads.push(new RecordedValueRead(result)); // Add as dependency for the next loads
        return watched(result);
    }
    finally {
        renderRun.loadCallIndex++;
    }



    function inner()  {
        const recordedReadsAreEqualSinceLastCall = lastLoadRun && recordedReadsArraysAreEqual(recordedReadsSincePreviousLoadCall, lastLoadRun.recordedReadsBefore)
        if(!recordedReadsAreEqualSinceLastCall) {
            persistent.loadRuns = persistent.loadRuns.slice(0, renderRun.loadCallIndex); // Erase all loadRuns after here (including this one).
            lastLoadRun = undefined;
        }

        /**
         * Can we use the result from last call ?
         */
        const canReuseLastResult = () => {
            if(!lastLoadRun) { // call was not recorded last render or is invalid?
                return false;
            }
            if (!recordedReadsAreEqualSinceLastCall) {
                return false;
            }

            if (lastLoadRun.recordedReadsInsideLoaderFn.some((r => r.isChanged))) { // I.e for "load( () => { fetch(props.x, myLocalValue) }) )" -> props.x or myLocalValue has changed?
                return false;
            }

            if (lastLoadRun.result.state === "resolved") {
                return {result: lastLoadRun.result.resolvedValue}
            }
            if (lastLoadRun.result.state === "pending") {
                renderRun.somePending = lastLoadRun.result.promise;
                renderRun.somePendingAreCritical ||= (options.critical !== false);
                if (fallback) { // Fallback available ?
                    return {result: fallback.value};
                }

                lastLoadRun.recordedReadsInsideLoaderFn.forEach(read => frame.watchPropertyChange(read)) // Also watch recordedReadsInsideLoaderFn (again in this frame)
                throw lastLoadRun.result.promise; // Throwing a promise will put the react component into suspense state
            } else if (lastLoadRun.result.state === "rejected") {
                lastLoadRun.recordedReadsInsideLoaderFn.forEach(read => frame.watchPropertyChange(read)) // Also watch recordedReadsInsideLoaderFn (again in this frame)
                throw lastLoadRun.result.rejectReason;
            } else {
                throw new Error("Invalid state of lastLoadRun.result.state")
            }
        }

        const canReuse = canReuseLastResult();
        if (canReuse !== false) { // can re-use ?
            const lastCall = persistent.loadRuns[renderRun.loadCallIndex];

            lastCall.recordedReadsInsideLoaderFn.forEach(read => frame.watchPropertyChange(read)) // Also watch recordedReadsInsideLoaderFn

            return canReuse.result; // return proxy'ed result from last call:
        }
        else { // cannot use last result ?
            if(renderRun.somePending && renderRun.somePendingAreCritical) { // Performance: Some previous (and dependent) results are pending, so loading this one would trigger a reload soon
                // don't make a new call
                if(fallback) {
                    return fallback.value;
                }
                else {
                    throw renderRun.somePending;
                }
            }

            // *** make a loadRun / exec loaderFn ***:

            let loadRun = new LoadRun(loadCall!, loaderFn, renderRun.loadCallIndex);
            loadRun.recordedReadsBefore = recordedReadsSincePreviousLoadCall;
            const resultPromise = Promise.resolve(loadRun.exec()); // Exec loaderFn
            loadRun.loaderFn = options.interval?loadRun.loaderFn:undefined; // Remove reference if not needed to not risk leaking memory
            loadRun.recordedReadsInsideLoaderFn = renderRun.recordedReads; renderRun.recordedReads = []; // pop and remember the (immediate) reads from inside the loaderFn

            resultPromise.then((value) => {
                loadRun.result = {state: "resolved", resolvedValue: value};

                if(loadRun.isObsolete) {
                    return;
                }

                /*
                const otherLoadsAreWaiting=true;// Other loads are waiting for this critical loadRun? TODO
                const wasErrored = true; // TODO
                if (fallback && (fallback.value === value) && !otherLoadsAreWaiting && !currentRenderRun!.isPassive && !wasErrored) { // Result is same as fallback (already displayed) + this situation allows to skip re-rendering because it would stay unchanged?
                    // Not worth it / too risky, just to save one rerender. Maybe i have overseen something.
                    if(persistent.currentFrame?.isListeningForChanges) { // Frame is "alive" ?
                        loadRun.activateRegularRePollingIfNeeded();
                    }
                } else {
                        persistent.handleChangeEvent(); // Will also do a rerender and call activateRegularRePollingIfNeeded, like above
                }
                */

                persistent.handleChangeEvent();
            });
            resultPromise.catch(reason => {
                loadRun.result = {state: "rejected", rejectReason: reason}

                if(loadRun.isObsolete) {
                    return;
                }

                persistent.handleChangeEvent(); // Re-render. The next render will see state=rejected for this load statement and throw it then.
            })
            loadRun.result = {state: "pending", promise: resultPromise};

            persistent.loadRuns[renderRun.loadCallIndex] = loadRun; // add / replace

            renderRun.somePending = resultPromise;
            renderRun.somePendingAreCritical ||= (options.critical !== false);

            if (fallback) {
                return fallback.value;
            } else {
                throw resultPromise; // Throwing a promise will put the react component into suspense state
            }
        }
    }

    function watched(value: unknown) { return (value !== null && typeof value === "object")?frame.watchedProxyFacade.getProxyFor(value):value }

    /**
     *
     * @param callStack
     * @returns i.e. "at http://localhost:5173/index.tsx:98:399"
     */
    function getCallerSourceLocation(callStack: String | undefined) {
        callStack = callStack!.replace(/.*load\(\.\.\.\) was called\s*/, ""); // Remove trailing error from callstack
        const callStackRows = callStack! .split("\n");
        callStackRows.length >= 2 || throwError(`Unexpected callstack format: ${callStack}`); // Validity check
        let result = callStackRows[1].trim();
        result !== "" || throwError("Illegal result");
        result = result.replace(/at\s*/, ""); // Remove trailing "at "
        return result;
    }
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

    return probe(() => renderRun.frame.persistent.loadRuns.some(c => c.result.state === "pending" && (!nameFilter || c.name === nameFilter)), false);
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
        return (renderRun.frame.persistent.loadRuns.find(c => c.result.state === "rejected" && (!nameFilter || c.name === nameFilter))?.result as any)?.rejectReason;
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