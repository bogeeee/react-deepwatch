import {
    RecordedRead,
    RecordedReadOnProxiedObject,
    RecordedValueRead,
    WatchedProxyFacade, installChangeTracker, RecordedPropertyRead
} from "proxy-facades";
import {
    array_peekLast,
    arraysAreEqualsByPredicateFn, arraysAreShallowlyEqual,
    isObject,
    newDefaultMap,
    PromiseState,
    recordedReadsArraysAreEqual,
    throwError
} from "./Util";
import {useLayoutEffect, useState, createElement, Fragment, ReactNode, useEffect, useContext, memo} from "react";
import {ErrorBoundaryContext, useErrorBoundary} from "react-error-boundary";
import {_preserve, preserve, PreserveOptions} from "./preserve";

let sharedWatchedProxyFacade: WatchedProxyFacade | undefined

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
     * Normally, everything that's **taken** from props, {@link useWatchedState} or {@link watched} or load(...)'s result will be returned, wrapped in a proxy that watches for modifications.
     * So far, so good, this can handle all stuff that's happening **inside** your component, but the outside world does not have these proxies. For example, when a parent component is not a watchedComponent, and passed in an object (i.e. the model) into this component via props.
     * Therefore this component can also **patch** these objects to make them watchable.
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

    /**
     * Shares a global proxy facade instance for all watchedComponents. This is the more tested and easier to think about option.
     * Disabling this creates a layer of new proxies for every of your child components. Object instances **inside** your component may still be consistent, but there could be: objInsideMyComponent !== myObjectHandedOverGloballyInSomeOtherWay. Real world use cases have to prove, if this is good way.
     * Note:
     * <p>
     *  Default: true
     * </p>
     */
    // Development: Note: Also keep in mind: `this.proxyHandler === other.proxyHandler` in RecordedPropertyRead#equals -> is this a problem? I assume that the component instances/state and therefore the watchedProxyFacades stay the same.
    useGlobalSharedProxyFacade?: boolean
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

    deps!: {auto_recordedReads: RecordedRead[]} | {explicit: unknown[]};

    recordedReadsInsideLoaderFn?: RecordedRead[];

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
                    //@ts-ignore TS2554 Expected 0-1 arguments, but got 2  - produces compile error when downstream projects include this lib and compile for <=ES2020.
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

function createWatchedProxyFacade() {
    const facade = new WatchedProxyFacade();
    facade.trackGetterCalls = true; // we need this for bindings
    // For bindings, we need to track reads for **all** facades:
    facade.onAfterRead((read) => {
        if(currentRenderRun) {
            currentRenderRun.binding_lastSeenRead = read;
            currentRenderRun.binding_lastSeenRead_outerMostGetter = facade.currentOutermostGetter;
        }
    })
    return facade;
}

/**
 * Fields that persist across re-render and across frames
 */
class WatchedComponentPersistent {
    options: WatchedComponentOptions;

    _nonSharedWatchedProxyFacade?: WatchedProxyFacade;

    get watchedProxyFacade() {
        if(this.options.useGlobalSharedProxyFacade === false) {
            return this._nonSharedWatchedProxyFacade || (this._nonSharedWatchedProxyFacade = createWatchedProxyFacade());
        }
        // Use a global shared instance
        return sharedWatchedProxyFacade || (sharedWatchedProxyFacade = createWatchedProxyFacade()); // Lazy initialize global variable
    }

    /**
     * props of the component. These are saved here in the state (in a non changing object instance), so code inside load call can watch **shallow** props changes on it.
     */
    watchedProps: {};

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

    /**
     * For the <a href="https://github.com/bogeeee/react-deepwatch/blob/main/readme.md#and-less-handing-onchange-listeners-to-child-components">"And less... handing onChange listeners to child components"</a> use case.
     * We don't want new object instances created, every time watched(..., {onChange:....}) is called. So we assign the proxy facade (see watched function) to the object
     */
    watchedObject_to_childProxyFacade = newDefaultMap<object, WatchedProxyFacade>(() => createWatchedProxyFacade());

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
        this.watchedProps = this.watchedProxyFacade.getProxyFor({})
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
                    installChangeTracker(read.origObj);
                }
            }
            catch (e) {
                if((e as Error).message?.startsWith("Cannot install change tracker on a proxy")) { // Hacky way to catch this. TODO: Expose a proper API for it.

                }
                else {
                    //@ts-ignore TS2554 Expected 0-1 arguments, but got 2  - produces compile error when downstream projects include this lib and compile for <=ES2020.
                    throw new Error(`Could not enhance the original object to track reads. This can fail, if it was created with some unsupported language constructs (defining read only properties; subclassing Array, Set or Map; ...). You can switch it off via the WatchedComponentOptions#watchOutside flag. I.e: const MyComponent = watchedComponent(props => {...}, {watchOutside: false})`, {cause: e});
                }
            }
        }

        // Re-render on a change of the read value:
        this.startPropChangeListeningFns.push(() => read.onAfterChange(this.watchPropertyChange_changeListenerFn /* Performance: We're not using an anonymous(=instance-changing) function here */, this.persistent.options.watchOutside !== false));
        this.cleanUpPropChangeListenerFns.push(() => read.offAfterChange(this.watchPropertyChange_changeListenerFn /* Performance: We're not using an anonymous(=instance-changing) function here */));
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

    /**
     * Recorded reads of this component's watchedProxyFacade for load(...) statements
     */
    load_recordedReads: RecordedRead[] = [];

    /**
     * Record the reads into which array? Undefined = recording muted
     */
    readsRecordingTarget?: RecordedRead[];

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

    /**
     * (Additional) effect functions (run after mount. Like with useEffect)
     */
    effectFns: (() => void)[] = [];

    /**
     * (Additional) effect cleanup functions
     */
    effectCleanupFns: (() => void)[] = [];

    /**
     * Last seen read on **all** watchedProxyFacade levels. {@see binding} needs the real, highest level read.
     */
    binding_lastSeenRead?: RecordedRead
    binding_lastSeenRead_outerMostGetter?: WatchedProxyFacade["currentOutermostGetter"]

    diagnosis_objectsWatchedWithOnChange = new Set<object>();

    constructor() {
        this.readsRecordingTarget = this.load_recordedReads;
    }

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
        this.effectFns.forEach(fn => fn());
    }

    /**
     * Called by useEffect before the next render oder before unmount(for suspense, for error or forever)
     */
    handleEffectCleanup() {
        // Call listeners:
        this.effectCleanupFns.forEach(fn => fn());
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

    /**
     * Mutes read-/dependency recording for load(...) statements while running fn()
     * @param fn
     */
    withRecordReadsInto<T>(fn: () => T, recordTarget: RecordedRead[] | undefined) {
        const origTarget = this.readsRecordingTarget;
        try {
            this.readsRecordingTarget = recordTarget;
            return fn();
        }
        finally {
            this.readsRecordingTarget = origTarget;
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
            //@ts-ignore
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
                renderRun.readsRecordingTarget?.push(read);
            };
            persistent.watchedProxyFacade.onAfterRead(readListener)

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
                persistent.watchedProxyFacade.offAfterRead(readListener);
            }
        }
        finally {
            renderRun.load_recordedReads = []; // renderRun is still referenced in closures, but this field is not needed, so let's not hold a big grown array here and may be prevent memory leaks
            renderRun.readsRecordingTarget = undefined;
            renderRun.binding_lastSeenRead = undefined;
            renderRun.binding_lastSeenRead_outerMostGetter = undefined;
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
     * Called, when a deep property was changed through the proxy.
     * Setting this, will create a new proxy-facade for the purpuse of watching changes only (deep) under that proxy.
     * <p>
     *     <a href="https://github.com/bogeeee/react-deepwatch/blob/main/readme.md#and-less-handing-onchange-listeners-to-child-components">Usage</a>
     * </p>
     */
    onChange?: () => void

    /**
     *
     * Called on a change to one of those properties, that were read-recorded in the component function (through the proxy of course).
     * Reacts also on external changes / not done through the proxy.
     */
    //onRecordedChange?: () => void
}

/**
 * Watches any (external) object and tracks reads to it's deep childs. Changes to these tracked reads will result in a re-render or re-load the load(...) statements that depend on it.
 * <p>
 * Also you can use it with the onChange option, see the <a href="https://github.com/bogeeee/react-deepwatch/blob/main/readme.md#and-less-handing-onchange-listeners-to-child-components">"And less... handing onChange listeners to child components"</a> use case.
 * </p>
 * @param obj original object to watch
 * @param options
 * @returns a proxy for the original object.
 */
export function watched<T extends object>(obj: T, options?: WatchedOptions): T {
    currentRenderRun || throwError("watched is not used from inside a watchedComponent");
    let result = currentRenderRun!.frame.persistent.watchedProxyFacade.getProxyFor(obj);
    if(options?.onChange) {
        // Safety check:
        !currentRenderRun!.diagnosis_objectsWatchedWithOnChange.has(result) || throwError("You have called watched(someObject, {onChange:...}) 2 times for the same someObj. This is not supported, since for keeping as much object instance consitency as possible, there is one fixed proxyfacade-for-change-tracking assiciated to it. If you really have a valid use case for watching the same object twice for changes, submit an issue.");
        currentRenderRun!.diagnosis_objectsWatchedWithOnChange.add(result)

        const facadeForChangeWatching = currentRenderRun!.frame.persistent.watchedObject_to_childProxyFacade.get(obj); // Might create a new facade

        // Listen for changes and call options.onChange during component mount:
        const changeHandler = (changeOperation: any) => options.onChange!()
        currentRenderRun!.effectFns.push(() => {facadeForChangeWatching.onAfterChange(changeHandler)});
        currentRenderRun!.effectCleanupFns.push(() => {facadeForChangeWatching.offAfterChange(changeHandler)});

        result = facadeForChangeWatching.getProxyFor(result);
    }
    return result;
}

/**
 * Saves the state like with useState(...) and watches and tracks reads to it's deep childs. Changes to these tracked reads will result in a re-render or re-load the load(...) statements that depend on it.
 * @param initial
 * @param options
 */
export function useWatchedState<S extends object>(initial: S, options?: WatchedOptions): S {
    currentRenderRun || throwError("useWatchedState is not used from inside a watchedComponent");

    const [state]  = useState(initial);
    return watched(state, options);
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
     * Specify dependencies. Just like with React's useEffect(...), a re-load will only be done, if these change. They are compared <strong>shallowly</strong>
     * You can insert the special identifier: READS_INSIDE_LOADER_FN. I.e. <code>import {READS_INSIDE_LOADER_FN} from "react-deepwatch"; ... load(..., {deps: [READS_INSIDE_LOADER_FN, myOtherDep]})</code>
     * <p>Default: Auto-dependencies. See readme.md</p>
     */
    deps?: unknown[]

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

    //safety check:
    !(options.deps !== undefined && !loadCall.isUniquelyIdentified()) || throwError(`Deps used, but the load(...) statement is not uniquely identifyable. Please specify a key via load(..., { key:<your key>, ...})`);

    loadCall.options = options; // Update options. It is allowed that these can change over time. I.e. the poll interval or the name.

    // Determine lastLoadRun:
    let lastLoadRun = renderRun.loadCallIndex < persistent.loadRuns.length?persistent.loadRuns[renderRun.loadCallIndex]:undefined;
    if(lastLoadRun) {
        lastLoadRun.loaderFn = options.interval ? loaderFn : undefined; // Update. only needed, when polling.
        //@ts-ignore TS2554 Expected 0-1 arguments, but got 2  - produces compile error when downstream projects include this lib and compile for <=ES2020.
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
        renderRun.load_recordedReads.push(new RecordedValueRead(result)); // Add as dependency for the next loads
        return watched(result);
    }
    finally {
        renderRun.loadCallIndex++;
    }



    function inner()  {
        function depsHaveChanngedSinceLastCall() {
            if(!lastLoadRun) {
                return true;
            }
            if(options.deps === undefined) { // Auto-deps?
                // Safety check:
                if(!("auto_recordedReads" in lastLoadRun.deps)) {
                    return true; // Seems like options have changed
                }

                if(!recordedReadsArraysAreEqual(renderRun.load_recordedReads, lastLoadRun.deps.auto_recordedReads)) { // Performance note: Quadratic growth here! Could optimize this
                    return true;
                }
            }
            else if(Array.isArray(options.deps)) { // Deps explicitly specified?
                // Safety check:
                if(!("explicit" in lastLoadRun.deps)) {
                    return true; // Seems like options have changed
                }

                if(!arraysAreShallowlyEqual(lastLoadRun.deps.explicit, options.deps)) { // deps have changed?
                    return true;
                }
            }
            else {
                throw new Error("Illegal value for options.deps");
            }

            if (lastLoadRun.recordedReadsInsideLoaderFn?.some((r => r.isChanged))) { // I.e for "load( () => { fetch(props.x, myLocalValue) }) )" -> props.x or myLocalValue has changed?
                return true;
            }
        }

        /**
         * Can we use the result from last call ?
         */
        const canReuseLastResult = () => {
            if(!lastLoadRun) { // call was not recorded last render or is invalid?
                return false;
            }
            if (depsHaveChanngedSinceLastCall()) {
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

                lastLoadRun.recordedReadsInsideLoaderFn?.forEach(read => frame.watchPropertyChange(read)) // Also watch recordedReadsInsideLoaderFn (again in this frame)
                throw lastLoadRun.result.promise; // Throwing a promise will put the react component into suspense state
            } else if (lastLoadRun.result.state === "rejected") {
                lastLoadRun.recordedReadsInsideLoaderFn?.forEach(read => frame.watchPropertyChange(read)) // Also watch recordedReadsInsideLoaderFn (again in this frame)
                throw lastLoadRun.result.rejectReason;
            } else {
                throw new Error("Invalid state of lastLoadRun.result.state")
            }
        }

        const canReuse = canReuseLastResult();
        if (canReuse !== false) { // can re-use ?
            const lastCall = persistent.loadRuns[renderRun.loadCallIndex];

            lastCall.recordedReadsInsideLoaderFn?.forEach(read => frame.watchPropertyChange(read)) // Also watch recordedReadsInsideLoaderFn (again in this frame)

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
            loadRun.deps = options.deps === undefined?{auto_recordedReads:  [...renderRun.load_recordedReads]}:{explicit: [...options.deps]} // Save deps
            // Exec loaderFn and record reasd to loadRun.recordedReadsInsideLoaderFn:
            if(options.deps === undefined || options.deps.includes(READS_INSIDE_LOADER_FN)) { // should reord reads ?
                loadRun.recordedReadsInsideLoaderFn = []; // this will make the following call record into them
            }
            const resultPromise = renderRun.withRecordReadsInto(() => {
                return Promise.resolve(loadRun.exec());
            }, loadRun.recordedReadsInsideLoaderFn);

            loadRun.loaderFn = options.interval?loadRun.loaderFn:undefined; // Remove reference if not needed to not risk leaking memory

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

    function watched(value: unknown) { return (value !== null && typeof value === "object")?persistent.watchedProxyFacade.getProxyFor(value):value }

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

export type ValueOnObject<T> = {value: T}

type BindingOptions = {
    isAccessor?: boolean
}

/**
 * Helper for {@see bind}. Looks up the last read and returns a binding for that.
 * @param prop
 * @param options
 */
export function binding<T>(prop: T, options?: BindingOptions): ValueOnObject<T> {
    const renderRun = currentRenderRun;
    // Validity check:
    if (renderRun === undefined) throw new Error("bind(...) not used from inside a watchedComponent");

    const diagnosis_msg = () => `Make sure, prop is derived from something watched: The component's 'props', or a useWatchedState(...) or a wached(...) or a load(...).`;

    let obj:object;
    let key: string | symbol;

    // Obtain lastRead:
    const lastRead = renderRun.binding_lastSeenRead;
    if(!lastRead) throw new Error("Illegal state: no recorded reads. ${diagnosis_msg()}");
    const diagnosis_moreMsg = () => `The last 'read' in your component function was of type: ${lastRead.constructor.name}`
    if(!(lastRead instanceof RecordedReadOnProxiedObject)) throw new Error(`Cannot determine property for input into bind(prop). ${diagnosis_msg()}\nMore info:${diagnosis_moreMsg()}`);

    if(array_peekLast(renderRun.load_recordedReads) === lastRead) { // Read was last recorded in the render run? Usually true, except when the binding is on a different facade layer (which is fine also)
        renderRun.load_recordedReads.pop(); // Don't treat the read as a dependency to load(...) statements, because the value is exclusively consumed by the input component
    }

    renderRun.withRecordReadsInto(() => { // With muted read recording
        if (renderRun.binding_lastSeenRead_outerMostGetter && !(options?.isAccessor === false)) { // getter call and user want's getters ?
            obj = renderRun.binding_lastSeenRead_outerMostGetter.proxy
            key = renderRun.binding_lastSeenRead_outerMostGetter.key
            //@ts-ignore
            prop === obj[key] || throwError(`The value of the last recorded read is not what's passed as 'prop' argument into bind(prop). ${diagnosis_msg()}\n The read was detected as a property-accessor: 'someObject.${key}'. If you didn't intend to bind to a getter/setter, try bind(...,{isAccessor:false})`);
        } else { // property access without getter:
            if (!(lastRead instanceof RecordedPropertyRead)) throw new Error(`Cannot determine property for input into bind(prop). ${diagnosis_msg()}\nMore info:${diagnosis_moreMsg()}`);

            obj = lastRead.proxy;
            key = lastRead.key;

            // Check if bind is deterministic:
            //@ts-ignore
            lastRead.value === obj[key] || throwError(`Illegal state: lastRead does not seem to be deterministic. ${diagnosis_msg()}\nMore info:${diagnosis_moreMsg()}`);
            prop === lastRead.value || throwError(`The value of the last recorded read is not what's passed as 'prop' argument into bind(prop). ${diagnosis_msg()}\nMore info:${diagnosis_moreMsg()}`);
        }
    }, undefined);

    return {
        get value() {
            if(!currentRenderRun)  throw new Error("Illegal state. Not called from the render run of a watchedComponent");

            return currentRenderRun.withRecordReadsInto(() => { // With muted read reacording. Get the value while not recording it as a read for the load(...) statements. Because this value is exclusively consumed by the input component and does never contribute as a dependency to load statements
                //@ts-ignore
                return obj[key] as T
            }, undefined)
        },
        set value(value) {
            //@ts-ignore
            obj[key] = value;
        }
    }
}

/**
 * For usage, see <a href="https://github.com/bogeeee/react-deepwatch/blob/main/readme.md#and-less-onchange-code-for-ltinputgt-elements">the docs</a>
 * @param prop the value from the object (not really just the value. react-deepwatch uses some tricks and looks at your last read to a proxied object, to determine the object and key of the binding)
 * @param options
 */
export function bind<T>(prop: T, options?: BindingOptions) {
    const bnd = binding(prop, options);
    return {
        value: bnd.value as any, // as any because too much compatibility issues
        checked: bnd.value as boolean,
        onChange: ((event: T | {target: {value: T}}) => {
            if(event !== null && typeof event === "object") {
                if(!("target" in event)) {
                    throw new Error("Event has no target property. The bind(...) function handles just input component with standard behaviour. If you have something more exotic and want it to work with bind, have a look at the (very short) source code of this bind function and implement onChange differently.")
                }
                if(event.target instanceof HTMLInputElement) { // native <input /> element ?
                    const type = event.target.type;
                    if(type === "checkbox") {
                        bnd.value = event.target.checked as T;
                    }
                    else if(type === "radio") {
                        throw new Error(`bind(...) is not supported for <input type="radio" />.`)
                    }
                    else { // most input elements accept a value
                        bnd.value = event.target.value as T;
                    }
                }
                else if(event.target instanceof HTMLSelectElement) {
                    bnd.value = event.target.value;
                }
                else if("checked" in event.target) {
                    bnd.value = event.target.checked as T; // assuming checkbix
                }
                else if("value" in event.target) {
                    bnd.value = event.target.value as T;
                }
                else {
                    throw new Error("This input type is not yet implemented with bind(...)")
                }
            }
            else { // event is a primitive ?
                bnd.value = event as T; // assume, that event is not an event but the immediate value
            }
        }) as ((event:any) => void) // too much compatibility issues
    };
}


export function debug_tagComponent(name: string) {
    currentRenderRun!.frame.persistent.debug_tag = name;
}

export {preserve} from "./preserve"
export type {PreserveOptions} from "./preserve"

/**
 * Flag/Single Enum
 */
export const READS_INSIDE_LOADER_FN = {}