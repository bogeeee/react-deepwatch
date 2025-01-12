import {GraphProxyHandler, ProxiedGraph} from "./proxiedGraph";
import {arraysAreEqualsByPredicateFn, MapSet} from "./Util";
import {
    enhanceWithWriteTracker,
    getWriteTrackerClassFor,
    objectIsEnhancedWithWriteTracker
} from "./globalWriteTracking";
import {getWriteListenersForArray, writeListenersForArray, WriteTrackedArray} from "./globalArrayWriteTracking";
import {
    AfterChangeOwnKeysListener,
    AfterReadListener,
    AfterWriteListener,
    Clazz,
    DualUseTracker, getPropertyDescriptor, runAndCallListenersOnce_after,
    ObjKey
} from "./common";
import {getWriteListenersForObject, writeListenersForObject} from "./globalObjectWriteTracking";
import _ from "underscore"


export abstract class RecordedRead {
    abstract equals(other: RecordedRead): boolean;

    abstract get isChanged(): boolean;

    /**
     *
     * @param listener
     * @param trackOriginal true to install a tracker on the non-proxied (by this facade) original object
     */
    abstract onChange(listener: () => void, trackOriginal?: boolean): void;

    abstract offChange(listener: () => void): void;
}

/**
 * Access a single value (=variable or return value from a function)
 * This read is can only be constructed manually (not through a WatchedGraph / WatchedGraphHandler
 */
export class RecordedValueRead extends RecordedRead{
    value: unknown;

    constructor(value: unknown) {
        super();
        this.value = value;
    }

    get isChanged(): boolean {
        throw new Error("Cannot check if simple value (not on object) has changed.");
    }

    onChange(listener: () => void, trackOriginal = false) {
        throw new Error("Cannot listen for changes on simple value (not on object)");
    }

    offChange(listener: () => void) {
    }

    equals(other: RecordedRead) {
        if(! (other instanceof RecordedValueRead)) {
            return false;
        }

        return this.value === other.value;
    }
}

export abstract class RecordedReadOnProxiedObject extends RecordedRead {
    proxyHandler!: WatchedGraphHandler
    /**
     * A bit redundant with proxyhandler. But for performance reasons, we leave it
     */
    obj!: object;
}

export class RecordedPropertyRead extends RecordedReadOnProxiedObject{
    key!: ObjKey;
    value!: unknown;


    constructor(key: ObjKey, value: unknown) {
        super();
        this.key = key;
        this.value = value;
    }

    get isChanged() {
        //@ts-ignore
        return this.obj[this.key] !== this.value;
    }

    onChange(listener: () => void, trackOriginal=false) {
        if(trackOriginal) {
            enhanceWithWriteTracker(this.obj); // Performance TODO: Install a setter trap ONLY for the property of interest. See ObjectProxyHandler#installSetterTrap
        }
        getWriteListenersForObject(this.obj).afterChangeProperty_listeners.add(this.key, listener);
        if(Array.isArray(this.obj)) {
            getWriteListenersForArray(this.obj).afterUnspecificWrite.add(listener);
        }
        debug_numberOfPropertyChangeListeners++;
    }

    offChange(listener: () => void) {
        writeListenersForObject.get(this.obj)?.afterChangeProperty_listeners.delete(this.key, listener);
        if(Array.isArray(this.obj)) {
            writeListenersForArray.get(this.obj)?.afterUnspecificWrite.delete(listener);
        }
        debug_numberOfPropertyChangeListeners--;
    }

    equals(other: RecordedRead) {
        if(! (other instanceof RecordedPropertyRead)) {
            return false;
        }

        return this.proxyHandler === other.proxyHandler && this.obj === other.obj && this.key === other.key && this.value === other.value;
    }
}

export class RecordedOwnKeysRead extends RecordedReadOnProxiedObject{
    value!: ArrayLike<string | symbol>;

    constructor(value: RecordedOwnKeysRead["value"]) {
        super();
        this.value = value;
    }

    get isChanged() {
        return !_.isEqual(Reflect.ownKeys(this.obj), this.value);
    }

    onChange(listener: AfterChangeOwnKeysListener, trackOriginal=false) {
        if(trackOriginal) {
            enhanceWithWriteTracker(this.obj);
        }
        getWriteListenersForObject(this.obj).afterChangeOwnKeys_listeners.add(listener);
        if(Array.isArray(this.obj)) {
            getWriteListenersForArray(this.obj).afterUnspecificWrite.add(listener);
        }
    }

    offChange(listener: AfterChangeOwnKeysListener) {
        writeListenersForObject.get(this.obj)?.afterChangeOwnKeys_listeners.delete(listener);
        if(Array.isArray(this.obj)) {
            writeListenersForArray.get(this.obj)?.afterUnspecificWrite.delete(listener);
        }
    }

    equals(other: RecordedRead) {
        if(! (other instanceof RecordedOwnKeysRead)) {
            return false;
        }

        return this.proxyHandler === other.proxyHandler && this.obj === other.obj && _.isEqual(this.value, other.value);
    }
}

export class RecordedArrayValuesRead extends RecordedReadOnProxiedObject {
    values: unknown[];
    
    protected get origObj() {
        return this.obj as unknown[];
    }


    constructor(values: unknown[]) {
        super();
        this.values = values;
    }

    onChange(listener: () => void, trackOriginal =false) {
        if(trackOriginal) {
            enhanceWithWriteTracker(this.origObj);
        }
        getWriteListenersForArray(this.origObj).afterUnspecificWrite.add(listener);
    }

    offChange(listener: () => void) {
        getWriteListenersForArray(this.origObj).afterUnspecificWrite.delete(listener);
    }
    
    equals(other: RecordedRead): boolean {
        if(! (other instanceof RecordedArrayValuesRead)) {
            return false;
        }

        return this.proxyHandler === other.proxyHandler && this.obj === other.obj && this.arraysAreShallowlyEqual(this.values, other.values);
    }

    get isChanged(): boolean {
        return this.arraysAreShallowlyEqual(this.values, this.origObj);
    }

    arraysAreShallowlyEqual(a: unknown[], b: unknown[]) {
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
}

export class RecordedSet_has extends RecordedRead {
    proxyHandler?: WatchedGraphHandler
    obj: Set<any>;
    key: any;
    value: boolean;

    /**
     * Possibly we could live without it and use events only in load.canReusePreviousResult
     */
    get isChanged(): boolean {
        throw new Error("TODO");
    }

    constructor() {
        super();
        throw new Error("TODO");
    }

    onChange(listener: () => void, trackOriginal = false) {
        throw new Error("TODO");
    }

    offChange(listener: () => void) {
        throw new Error("TODO");
    }

    equals(other: RecordedRead): boolean {
        throw new Error("TODO");
    }
}

export class RecordedSet_values extends RecordedRead {
    proxyHandler?: WatchedGraphHandler
    obj: Set<any>;
    value: any[];

    get isChanged(): boolean {
        throw new Error("TODO");
    }

    constructor() {
        super();
        throw new Error("TODO");
    }

    onChange(listener: () => void, trackOriginal = false) {
        throw new Error("TODO");
    }

    offChange(listener: () => void) {
        throw new Error("TODO");
    }

    equals(other: RecordedRead): boolean {
        throw new Error("TODO");
    }
}
//TODO ...

export function recordedReadsArraysAreEqual(a: RecordedRead[], b: RecordedRead[]) {
    return arraysAreEqualsByPredicateFn(a, b, (a, b) => a.equals(b) );
}

/**
 * Use cases:
 * - record read + watch recorded for modifications. For re-render trigger
 * - record read and make several snapshots (when load is called) and compare exactly those reads
 */
export class WatchedGraph extends ProxiedGraph<WatchedGraphHandler> {
    // ** Configuration**
    /**
     * Watches also writes that are not made through a proxy of this WatchedGraph by installing a setter (property accessor) on each of the desired properties
     * Works only for **individual** properties which you are explicitly listening on, and not on the whole Graph.
     * See {@link onAfterWrite} for the listener
     *
     */
    public watchWritesFromOutside = false; //

    trackReadsOnPrototype = false;

    // *** State: ****

    /**
     * Called after a read has been made to any object inside this graph
     * @protected
     */
    _afterReadListeners = new Set<AfterReadListener>()

    /**
     * Called after a write has been made to any object inside this graph
     * Note: There are also listeners for specified properties (which are more capable)
     * TODO: Do we need this ?
     * @protected
     */
    _afterWriteListeners = new Set<AfterWriteListener>()


    onAfterRead(listener: AfterReadListener) {
        this._afterReadListeners.add(listener);
    }

    offAfterRead(listener: AfterReadListener) {
        this._afterReadListeners.delete(listener);
    }

    /**
     * Watches for writes on a specified property
     * @deprecated Watching is global and not bound to this WatchedGraph
     * @param obj
     * @param key Not restricted here (for the tests), but it must not be number !
     * @param listener
     */
    onAfterWriteOnProperty<O extends  object, K extends keyof O>(obj: O, key: K, listener:  AfterWriteListener) {
        if(this.watchWritesFromOutside) {
            throw new Error("TODO");
        }
        else {
            getWriteListenersForObject(obj).afterChangeProperty_listeners.add(key as ObjKey, listener);
        }

    }

    /**
     * Watches for writes on a specified property
     * @deprecated Watching is global and not bound to this WatchedGraph
     * @param obj
     * @param key Not restricted here (for the tests), but it must not be number !
     * @param listener
     */
    offAfterWriteOnProperty<O extends  object, K extends keyof O>(obj: O, key: K, listener:  AfterWriteListener) {
        if(this.watchWritesFromOutside) {
            throw new Error("TODO");
        }
        else {
            writeListenersForObject.get(obj)?.afterChangeProperty_listeners.add(key as ObjKey, listener);
        }
    }

    protected crateHandler(target: object, graph: any): WatchedGraphHandler {
        return new WatchedGraphHandler(target, graph);
    }
}

export interface ForWatchedGraphHandler<T> extends DualUseTracker<T> {
    /**
     * Will return the handler when called through the handler
     */
    get _watchedGraphHandler(): WatchedGraphHandler;

    /**
     * The original (unproxied) object
     */
    get _target(): T
}

/**
 * Patches methods / accessors
 */
class WatchedArray_for_WatchedGraphHandler<T> extends Array<T> implements ForWatchedGraphHandler<Array<T>> {
    get _watchedGraphHandler(): WatchedGraphHandler {
        throw new Error("not calling from inside a WatchedGraphHandler"); // Will return the handler when called through the handler
    }
    get _target(): Array<T> {
        throw new Error("not calling from inside a WatchedGraphHandler"); // Will return the value when called through the handler
    }

    protected _fireAfterValuesRead() {
        let recordedArrayValuesRead = new RecordedArrayValuesRead([...this._target]);
        this._watchedGraphHandler?.fireAfterRead(recordedArrayValuesRead);
    }

    /**
     * Pretend that this is an array
     */
    get ["constructor"]() {
        return Array;
    }

    values(): ArrayIterator<T> {
        const result = this._target.values();
        this._fireAfterValuesRead();
        return result;
    }

    [Symbol.iterator](): ArrayIterator<T> {
        const result = this._target[Symbol.iterator]();
        this._fireAfterValuesRead();
        return result;
    }

    get length(): number {
        const result = this._target.length;
        this._fireAfterValuesRead();
        return result;
    }

    //@ts-ignore
    unshift(...items): number {
        const result = this._target.unshift(...items);
        this._fireAfterValuesRead();
        return result;
    }

    //forEach(...args: any[]) // Already reads "length" an thererfore triggers the read

    //@ts-ignore
    splice(...items): T[] {
        //@ts-ignore
        const result = this._target.splice(...items);
        this._fireAfterValuesRead();
        return result;
    }

    //@ts-ignore
    pop(...args: any[]): T | undefined {
        //@ts-ignore
        const result = this._target.pop(...args);
        this._fireAfterValuesRead();
        return result;
    }

}

export class WatchedGraphHandler extends GraphProxyHandler<WatchedGraph> {
    /**
     * Classes for watchers / write-trackers
     */
    static supervisorClassesMap = new Map<Clazz, WatchedGraphHandler["supervisorClasses"]>([
        [Array, {watcher: WatchedArray_for_WatchedGraphHandler, writeTracker: WriteTrackedArray}]
    ]);
    
    /**
     * "Serve" these classes's methods and property accessors.
     */
    supervisorClasses: {watcher: Clazz, writeTracker: Clazz} | undefined


    constructor(target: object, graph: WatchedGraph) {
        super(target, graph);

        // determine watch and write- supervisorClasses:
        for(const ClassToSupervise of WatchedGraphHandler.supervisorClassesMap.keys()) {
            if(target instanceof ClassToSupervise) {
                this.supervisorClasses = WatchedGraphHandler.supervisorClassesMap.get(ClassToSupervise);
                if(target.constructor !== ClassToSupervise && target.constructor !== this.supervisorClasses!.writeTracker) {
                    throw new Error(`Cannot create proxy of a **subclass** of ${ClassToSupervise.name} or ${this.supervisorClasses!.writeTracker.name}. It must be directly that class.`)
                }
            }
        }
    }

    fireAfterRead(read: RecordedReadOnProxiedObject) {
        read.proxyHandler = this;
        read.obj = this.target;

        this.graph._afterReadListeners.forEach(l => l(read)); // Inform listeners
    }

    get (fake_target:object, p:string | symbol, dontUse_receiver:any) {
        if(p === "_watchedGraphHandler") { // TODO: use symbol for that (performance)
            return this;
        }
        if(p === "_target") { // TODO: use symbol for that (performance)
            return this.target;
        }

        // Check for and use supervisor class:
        if(this.supervisorClasses !== undefined) {
            for(const SupervisorClass of [this.supervisorClasses.watcher, this.supervisorClasses.writeTracker]) {
                let propOnSupervisor = Object.getOwnPropertyDescriptor(SupervisorClass.prototype, p);
                if(propOnSupervisor !== undefined) { // Supervisor class is responsible for the property (or method) ?
                    //@ts-ignore
                    if(propOnSupervisor.get) { // Prop is a getter?
                        return this.graph.getProxyFor(propOnSupervisor.get.apply(this.proxy))
                    }
                    else if(propOnSupervisor.value) { // Prop is a value, meaning a function. (Supervisors don't have fields)
                        return SupervisorClass.prototype[p];
                    }
                }
            }
        }

        return super.get(fake_target, p, dontUse_receiver);
    }

    rawRead(key: ObjKey) {
        const result = super.rawRead(key);
        if(!this.graph.trackReadsOnPrototype) {
            if(Object.getOwnPropertyDescriptor(this.target, key) === undefined && getPropertyDescriptor(this.target,key ) !== undefined) { // Property is on prototype only ?
                return result;
            }
        }
        this.fireAfterRead(new RecordedPropertyRead(key, result)); // Inform listeners
        return result;
    }

    protected rawChange(key: string | symbol, newValue: any) {
        runAndCallListenersOnce_after(this.target, (callListeners) => {
            const isNewProperty = getPropertyDescriptor(this.target, key) === undefined;
            super.rawChange(key, newValue);
            if(!objectIsEnhancedWithWriteTracker(this.target)) { // Listeners were not already called ?
                if(Array.isArray(this.target)) {
                    callListeners(writeListenersForArray.get(this.target)?.afterUnspecificWrite);
                }
                const writeListeners = writeListenersForObject.get(this.target);
                callListeners(writeListeners?.afterChangeProperty_listeners.get(key));
                if (isNewProperty) {
                    callListeners(writeListeners?.afterChangeOwnKeys_listeners);
                }
            }
        });

    }

    deleteProperty(target: object, key: string | symbol): boolean {
        return runAndCallListenersOnce_after(this.target, (callListeners) => {
            const doesExists = Object.getOwnPropertyDescriptor(this.target, key) !== undefined;
            if (doesExists) {
                this.set(target, key, undefined, this.proxy); // Set to undefined first, so property change listeners will get informed
            }
            const result = super.deleteProperty(target, key);
            if (doesExists) {
                if (!objectIsEnhancedWithWriteTracker(this.target)) { // Listeners were not already called ?
                    callListeners(writeListenersForObject.get(this.target)?.afterChangeOwnKeys_listeners);
                }
            }
            return result;
        });
    }

    ownKeys(target: object): ArrayLike<string | symbol> {
        const result = Reflect.ownKeys(this.target);
        this.fireAfterRead(new RecordedOwnKeysRead(result))
        return result;
    }
}





/**
 * Only counts on vs off calls for a quick alignment check
 */
export let debug_numberOfPropertyChangeListeners = 0;