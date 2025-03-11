import {GraphProxyHandler, ProxiedGraph} from "./proxiedGraph";
import {
    arraysAreEqualsByPredicateFn,
    arraysAreShallowlyEqual,
    arraysWithEntriesAreShallowlyEqual,
    MapSet, throwError
} from "./Util";
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
    ObjKey, WriteTrackerClass, checkEsRuntimeBehaviour
} from "./common";
import {getWriteListenersForObject, writeListenersForObject} from "./globalObjectWriteTracking";
import _ from "underscore"
import {getWriteListenersForSet, writeListenersForSet, WriteTrackedSet} from "./globalSetWriteTracking";
import {getWriteListenersForMap, writeListenersForMap, WriteTrackedMap} from "./globalMapWriteTracking";


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
        getWriteListenersForObject(this.obj).afterChangeSpecificProperty_listeners.add(this.key, listener);
        if(Array.isArray(this.obj)) {
            getWriteListenersForObject(this.obj).afterUnspecificWrite.add(listener);
        }
        debug_numberOfPropertyChangeListeners++;
    }

    offChange(listener: () => void) {
        writeListenersForObject.get(this.obj)?.afterChangeSpecificProperty_listeners.delete(this.key, listener);
        if(Array.isArray(this.obj)) {
            writeListenersForObject.get(this.obj)?.afterUnspecificWrite.delete(listener);
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
            getWriteListenersForObject(this.obj).afterUnspecificWrite.add(listener);
        }
    }

    offChange(listener: AfterChangeOwnKeysListener) {
        writeListenersForObject.get(this.obj)?.afterChangeOwnKeys_listeners.delete(listener);
        if(Array.isArray(this.obj)) {
            writeListenersForObject.get(this.obj)?.afterUnspecificWrite.delete(listener);
        }
    }

    equals(other: RecordedRead) {
        if(! (other instanceof RecordedOwnKeysRead)) {
            return false;
        }

        return this.proxyHandler === other.proxyHandler && this.obj === other.obj && _.isEqual(this.value, other.value);
    }
}

/**
 * Fired when a method was called that is not implemented in the supervisor. May be from a future js version
 */
export class RecordedUnspecificRead extends RecordedReadOnProxiedObject{
    get isChanged() {
        return true;
    }

    onChange(listener: () => void, trackOriginal=false) {
        if(trackOriginal) {
            enhanceWithWriteTracker(this.obj);
        }
        getWriteListenersForObject(this.obj).afterAnyWrite_listeners.add(listener);
    }

    offChange(listener: AfterChangeOwnKeysListener) {
        writeListenersForObject.get(this.obj)?.afterAnyWrite_listeners.delete(listener);
    }

    equals(other: RecordedRead) {
        return false;
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
        getWriteListenersForObject(this.origObj).afterChangeOwnKeys_listeners.add(listener);
        getWriteListenersForObject(this.origObj).afterChangeAnyProperty_listeners.add(listener);
        getWriteListenersForObject(this.origObj).afterUnspecificWrite.add(listener);
    }

    offChange(listener: () => void) {
        getWriteListenersForObject(this.origObj).afterUnspecificWrite.delete(listener);
        getWriteListenersForObject(this.origObj).afterChangeAnyProperty_listeners.delete(listener);
        getWriteListenersForObject(this.origObj).afterChangeOwnKeys_listeners.delete(listener);
    }
    
    equals(other: RecordedRead): boolean {
        if(! (other instanceof RecordedArrayValuesRead)) {
            return false;
        }

        return this.proxyHandler === other.proxyHandler && this.obj === other.obj && arraysAreShallowlyEqual(this.values, other.values);
    }

    get isChanged(): boolean {
        return !arraysAreShallowlyEqual(this.values, this.origObj);
    }


}

export class RecordedSet_has extends RecordedReadOnProxiedObject {
    value!: unknown;
    /**
     * Result of the .has call
     */
    result: boolean;
    obj!: Set<unknown>;


    constructor(value: unknown, result: boolean) {
        super();
        this.value = value;
        this.result = result;
    }

    get isChanged() {
        return this.result !== this.obj.has(this.value);
    }

    onChange(listener: () => void, trackOriginal=false) {
        if(trackOriginal) {
            enhanceWithWriteTracker(this.obj);
        }
        getWriteListenersForSet(this.obj).afterSpecificValueChanged.add(this.value, listener);
        getWriteListenersForObject(this.obj).afterUnspecificWrite.add(listener);
    }

    offChange(listener: () => void) {
        writeListenersForSet.get(this.obj)?.afterSpecificValueChanged.delete(this.value, listener);
        writeListenersForObject.get(this.obj)?.afterUnspecificWrite.delete(listener);

    }

    equals(other: RecordedRead) {
        if(! (other instanceof RecordedSet_has)) {
            return false;
        }

        return this.proxyHandler === other.proxyHandler && this.obj === other.obj && this.value === other.value && this.result === other.result;
    }
}

export class RecordedSetValuesRead extends RecordedReadOnProxiedObject {
    values: Array<unknown>;

    protected get origObj() {
        return this.obj as Set<unknown>;
    }


    constructor(values: Array<unknown>) {
        super();
        this.values = values;
    }

    onChange(listener: () => void, trackOriginal =false) {
        if(trackOriginal) {
            enhanceWithWriteTracker(this.origObj);
        }
        getWriteListenersForSet(this.origObj).afterAnyValueChanged.add(listener);
        getWriteListenersForObject(this.origObj).afterUnspecificWrite.add(listener);
    }

    offChange(listener: () => void) {
        getWriteListenersForObject(this.origObj).afterUnspecificWrite.delete(listener);
        getWriteListenersForSet(this.origObj).afterAnyValueChanged.delete(listener);
    }

    equals(other: RecordedRead): boolean {
        if(! (other instanceof RecordedSetValuesRead)) {
            return false;
        }

        return this.proxyHandler === other.proxyHandler && this.obj === other.obj && arraysAreShallowlyEqual(this.values, other.values);
    }

    get isChanged(): boolean {
        return !arraysAreShallowlyEqual(this.values, [...(this.origObj as Set<unknown>).values()]);
    }
}

export class RecordedMap_get extends RecordedReadOnProxiedObject {
    key!: unknown;

    keyExists: boolean;
    /**
     * Result of the .get call
     */
    value: unknown;
    obj!: Map<unknown, unknown>;


    constructor(key: unknown, keyExists: boolean, value: unknown) {
        super();
        this.key = key;
        this.keyExists = keyExists;
        this.value = value;
    }

    get isChanged() {
        return !(this.keyExists === this.obj.has(this.key) && this.value === this.obj.get(this.key));
    }

    onChange(listener: () => void, trackOriginal=false) {
        if(trackOriginal) {
            enhanceWithWriteTracker(this.obj);
        }
        getWriteListenersForMap(this.obj).afterSpecificKeyAddedOrRemoved.add(this.key, listener);
        getWriteListenersForMap(this.obj).afterSpecificValueChanged.add(this.key, listener);
        getWriteListenersForObject(this.obj).afterUnspecificWrite.add(listener);
    }

    offChange(listener: () => void) {
        writeListenersForObject.get(this.obj)?.afterUnspecificWrite.delete(listener);
        writeListenersForMap.get(this.obj)?.afterSpecificValueChanged.delete(this.key, listener);
        writeListenersForMap.get(this.obj)?.afterSpecificKeyAddedOrRemoved.delete(this.key, listener);
    }

    equals(other: RecordedRead) {
        if(! (other instanceof RecordedMap_get)) {
            return false;
        }

        return this.proxyHandler === other.proxyHandler && this.obj === other.obj && this.key === other.key && this.keyExists == other.keyExists && this.value === other.value;
    }
}

export class RecordedMap_has extends RecordedReadOnProxiedObject {
    key!: unknown;

    /**
     * Result of the .has call
     */
    keyExists: boolean;
    obj!: Map<unknown, unknown>;


    constructor(key: unknown, keyExists: boolean) {
        super();
        this.key = key;
        this.keyExists = keyExists;
    }

    get isChanged() {
        return this.keyExists !== this.obj.has(this.key);
    }

    onChange(listener: () => void, trackOriginal=false) {
        if(trackOriginal) {
            enhanceWithWriteTracker(this.obj);
        }
        getWriteListenersForMap(this.obj).afterSpecificKeyAddedOrRemoved.add(this.key, listener);
        getWriteListenersForObject(this.obj).afterUnspecificWrite.add(listener);
    }

    offChange(listener: () => void) {
        writeListenersForObject.get(this.obj)?.afterUnspecificWrite.delete(listener);
        writeListenersForMap.get(this.obj)?.afterSpecificKeyAddedOrRemoved.delete(this.key, listener);
    }

    equals(other: RecordedRead) {
        if(! (other instanceof RecordedMap_has)) {
            return false;
        }

        return this.proxyHandler === other.proxyHandler && this.obj === other.obj && this.key === other.key && this.keyExists === other.keyExists;
    }
}

export class RecordedMapKeysRead extends RecordedReadOnProxiedObject {
    keys: Array<unknown>;

    protected get origObj() {
        return this.obj as Map<unknown, unknown>;
    }


    constructor(keys: Array<unknown>) {
        super();
        this.keys = keys;
    }

    onChange(listener: () => void, trackOriginal =false) {
        if(trackOriginal) {
            enhanceWithWriteTracker(this.origObj);
        }
        getWriteListenersForMap(this.origObj).afterAnyKeyAddedOrRemoved.add(listener);
        getWriteListenersForObject(this.origObj).afterUnspecificWrite.add(listener);
    }

    offChange(listener: () => void) {
        getWriteListenersForObject(this.origObj).afterUnspecificWrite.delete(listener);
        getWriteListenersForMap(this.origObj).afterAnyKeyAddedOrRemoved.delete(listener);
    }

    equals(other: RecordedRead): boolean {
        if(! (other instanceof RecordedMapKeysRead)) {
            return false;
        }

        return this.proxyHandler === other.proxyHandler && this.obj === other.obj && arraysAreShallowlyEqual(this.keys, other.keys);
    }

    get isChanged(): boolean {
        return !arraysAreShallowlyEqual(this.keys, [...(this.origObj as Map<unknown, unknown>).keys()]);
    }
}

export class RecordedMapValuesRead extends RecordedReadOnProxiedObject {
    values: Array<unknown>;

    protected get origObj() {
        return this.obj as Map<unknown, unknown>;
    }


    constructor(values: Array<unknown>) {
        super();
        this.values = values;
    }

    onChange(listener: () => void, trackOriginal =false) {
        if(trackOriginal) {
            enhanceWithWriteTracker(this.origObj);
        }
        getWriteListenersForMap(this.origObj).afterAnyValueChanged.add(listener);
        getWriteListenersForObject(this.origObj).afterUnspecificWrite.add(listener);
    }

    offChange(listener: () => void) {
        getWriteListenersForObject(this.origObj).afterUnspecificWrite.delete(listener);
        getWriteListenersForMap(this.origObj).afterAnyValueChanged.delete(listener);
    }

    equals(other: RecordedRead): boolean {
        if(! (other instanceof RecordedMapValuesRead)) {
            return false;
        }

        return this.proxyHandler === other.proxyHandler && this.obj === other.obj && arraysAreShallowlyEqual(this.values, other.values);
    }

    get isChanged(): boolean {
        return !arraysAreShallowlyEqual(this.values, [...(this.origObj as Map<unknown, unknown>).values()]);
    }
}

export class RecordedMapEntriesRead extends RecordedReadOnProxiedObject {
    values: Array<[unknown, unknown]>;

    protected get origObj() {
        return this.obj as Map<unknown, unknown>;
    }


    constructor(values: Array<[unknown, unknown]>) {
        super();
        this.values = values;
    }

    onChange(listener: () => void, trackOriginal =false) {
        if(trackOriginal) {
            enhanceWithWriteTracker(this.origObj);
        }
        getWriteListenersForMap(this.origObj).afterAnyKeyAddedOrRemoved.add(listener);
        getWriteListenersForMap(this.origObj).afterAnyValueChanged.add(listener);
        getWriteListenersForObject(this.origObj).afterUnspecificWrite.add(listener);
    }

    offChange(listener: () => void) {
        getWriteListenersForObject(this.origObj).afterUnspecificWrite.delete(listener);
        getWriteListenersForMap(this.origObj).afterAnyValueChanged.delete(listener);
        getWriteListenersForMap(this.origObj).afterAnyKeyAddedOrRemoved.delete(listener);
    }

    equals(other: RecordedRead): boolean {
        if(! (other instanceof RecordedMapEntriesRead)) {
            return false;
        }

        return this.proxyHandler === other.proxyHandler && this.obj === other.obj && arraysWithEntriesAreShallowlyEqual(this.values, other.values);
    }

    get isChanged(): boolean {
        return !arraysWithEntriesAreShallowlyEqual(this.values, [...(this.origObj as Map<unknown, unknown>).entries()]);
    }
}


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

    constructor() {
        super();
        checkEsRuntimeBehaviour();
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
            getWriteListenersForObject(obj).afterChangeSpecificProperty_listeners.add(key as ObjKey, listener);
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
            writeListenersForObject.get(obj)?.afterChangeSpecificProperty_listeners.add(key as ObjKey, listener);
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

    entries(): ArrayIterator<[number, T]> {
        const result = this._target.entries();
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
    shift(...args: any[]) {
        return runAndCallListenersOnce_after(this._target, (callListeners) => {
            //@ts-ignore
            const result = this._target.shift(...args);
            callListeners(getWriteListenersForObject(this._target)?.afterChangeOwnKeys_listeners);
            callListeners(getWriteListenersForObject(this._target)?.afterUnspecificWrite);
            callListeners(getWriteListenersForObject(this._target)?.afterAnyWrite_listeners);
            this._fireAfterValuesRead();
            return result;
        });
    }


    /**
     * Keep this method so it it treated as handled and not as making-unspecific-reads
     * @param args
     */
    forEach(...args: any[]) {
        //@ts-ignore
        return super.forEach(...args); //reads "length" an thererfore triggers the read
    }


    //@ts-ignore
    pop(...args: any[]): T | undefined {
        return runAndCallListenersOnce_after(this._target, (callListeners) => {
            //@ts-ignore
            const result = this._target.pop(...args);
            callListeners(getWriteListenersForObject(this._target)?.afterChangeOwnKeys_listeners);
            callListeners(getWriteListenersForObject(this._target)?.afterUnspecificWrite);
            callListeners(getWriteListenersForObject(this._target)?.afterAnyWrite_listeners);
            this._fireAfterValuesRead();
            return result;
        });

    }

    //TODO:    slice(start?: number, end?: number): T[] {}

}

class WatchedSet_for_WatchedGraphHandler<T> extends Set<T> implements ForWatchedGraphHandler<Set<T>> {
    get _watchedGraphHandler(): WatchedGraphHandler {
        throw new Error("not calling from inside a WatchedGraphHandler"); // Will return the handler when called through the handler
    }
    get _target(): Set<T> {
        throw new Error("not calling from inside a WatchedGraphHandler"); // Will return the value when called through the handler
    }

    protected _fireAfterValuesRead() {
        let recordedSetValuesRead = new RecordedSetValuesRead([...this._target]);
        this._watchedGraphHandler?.fireAfterRead(recordedSetValuesRead);
    }

    /**
     * Pretend that this is a Set
     */
    get ["constructor"]() {
        return Set;
    }

    has(value:T): boolean {
        const result = this._target.has(value);

        const read = new RecordedSet_has(value, result);
        this._watchedGraphHandler?.fireAfterRead(read);

        return result;
    }

    values(): SetIterator<T> {
        const result = this._target.values();
        this._fireAfterValuesRead();
        return result;
    }

    entries(): SetIterator<[T, T]> {
        const result = this._target.entries();
        this._fireAfterValuesRead();
        return result;
    }

    keys(): SetIterator<T> {
        const result = this._target.keys();
        this._fireAfterValuesRead();
        return result;
    }

    forEach(...args: unknown[]) {
        //@ts-ignore
        const result = this._target.forEach(...args);
        this._fireAfterValuesRead();
        return result;
    }

    [Symbol.iterator](): SetIterator<T> {
        const result = this._target[Symbol.iterator]();
        this._fireAfterValuesRead();
        return result;
    }

    get size(): number {
        const result = this._target.size;
        this._fireAfterValuesRead();
        return result;
    }
}

class WatchedMap_for_WatchedGraphHandler<K,V> extends Map<K, V> implements ForWatchedGraphHandler<Map<K, V>> {
    get _watchedGraphHandler(): WatchedGraphHandler {
        throw new Error("not calling from inside a WatchedGraphHandler"); // Will return the handler when called through the handler
    }
    get _target(): Map<K,V> {
        throw new Error("not calling from inside a WatchedGraphHandler"); // Will return the value when called through the handler
    }

    protected _fireAfterEntriesRead() {
        let recordedMapEntriesRead = new RecordedMapEntriesRead([...this._target.entries()]);
        this._watchedGraphHandler?.fireAfterRead(recordedMapEntriesRead);
    }

    /**
     * Pretend that this is a Map
     */
    get ["constructor"]() {
        return Map;
    }

    get(key:K): V | undefined {
        const keyExists = this._target.has(key);
        const result = this._target.get(key);

        const read = new RecordedMap_get(key, keyExists, result);
        this._watchedGraphHandler?.fireAfterRead(read);

        return result;
    }

    has(key:K): boolean {
        const result = this._target.has(key);

        const read = new RecordedMap_has(key, result);
        this._watchedGraphHandler?.fireAfterRead(read);

        return result;
    }

    values(): MapIterator<V> {
        const result = this._target.values();

        let recordedMapValuesRead = new RecordedMapValuesRead([...result]);
        this._watchedGraphHandler?.fireAfterRead(recordedMapValuesRead);

        return result;
    }

    entries(): MapIterator<[K, V]> {
        const result = this._target.entries();
        this._fireAfterEntriesRead();
        return result;
    }

    keys(): MapIterator<K> {
        const result = this._target.keys();

        let recordedMapKeysRead = new RecordedMapKeysRead([...result]);
        this._watchedGraphHandler?.fireAfterRead(recordedMapKeysRead);
        
        return result;
    }

    forEach(...args: unknown[]) {
        //@ts-ignore
        const result = this._target.forEach(...args);
        this._fireAfterEntriesRead();
        return result;
    }

    [Symbol.iterator](): MapIterator<[K,V]> {
        const result = this._target[Symbol.iterator]();
        this._fireAfterEntriesRead();
        return result;
    }

    get size(): number {
        const result = this._target.size;

        let recordedMapKeysRead = new RecordedMapKeysRead([...this._target.keys()]); // TODO: RecordedMapSizeRead
        this._watchedGraphHandler?.fireAfterRead(recordedMapKeysRead);
        
        return result;
    }
}

export class WatchedGraphHandler extends GraphProxyHandler<WatchedGraph> {
    /**
     * Classes for watchers / write-trackers
     */
    static supervisorClassesMap = new Map<Clazz, WatchedGraphHandler["supervisorClasses"]>([
        [Array, {watcher: WatchedArray_for_WatchedGraphHandler, writeTracker: WriteTrackedArray}],
        [Set, {watcher: WatchedSet_for_WatchedGraphHandler, writeTracker: WriteTrackedSet}],
        [Map, {watcher: WatchedMap_for_WatchedGraphHandler, writeTracker: WriteTrackedMap}]
    ]);
    
    /**
     * "Serve" these classes's methods and property accessors.
     */
    supervisorClasses: {watcher: Clazz, writeTracker: WriteTrackerClass} | undefined


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

    get (fake_target:object, key:string | symbol, receiver:any) {
        const target = this.target;
        const thisHandler = this;
        const receiverMustBeNonProxied = this.supervisorClasses?.writeTracker.receiverMustBeNonProxied;

        if(key === "_watchedGraphHandler") { // TODO: use symbol for that (performance)
            return this;
        }
        if(key === "_target") { // TODO: use symbol for that (performance)
            return this.target;
        }

        // Check for and use supervisor class:
        if(this.supervisorClasses !== undefined) {
            for(const SupervisorClass of [this.supervisorClasses.watcher, this.supervisorClasses.writeTracker]) {
                let propOnSupervisor = Object.getOwnPropertyDescriptor(SupervisorClass.prototype, key);
                if(propOnSupervisor !== undefined) { // Supervisor class is responsible for the property (or method) ?
                    //@ts-ignore
                    if(propOnSupervisor.get) { // Prop is a getter?
                        return this.graph.getProxyFor(this.graph.getProxyFor(propOnSupervisor.get.apply(this.proxy)));
                    }
                    if(propOnSupervisor.set) { // Prop is a setter ?
                        throw new Error("setters not yet implemented")
                    }
                    else {
                        typeof propOnSupervisor.value === "function" || throwError(`Accessing supervisor's plain property: ${String(key)}`); // validity check
                        const supervisorMethod = propOnSupervisor.value;
                        return function withProxiedResult(this:unknown, ...args: unknown[]) {
                            return thisHandler.graph.getProxyFor(supervisorMethod.apply(this, args)); // Call and wrap result in a proxy
                        }
                    }
                }
            }
            origMethod = this.supervisorClasses.writeTracker.prototype[key]
            // When arriving here, the field is not **directly** in one of the supervisor classes
            if(this.supervisorClasses.writeTracker.knownHighLevelMethods.has(key)) {
                return trapHighLevelReaderWriterMethod
            }

            if(typeof origMethod === "function" && !(key as any in Object.prototype)) { // Read+write method that was not handled directly by supervisor class?
                if(this.supervisorClasses.writeTracker.readOnlyMethods.has(key)) {
                    return trapForGenericReaderMethod
                }
                else {
                    return trapForGenericReaderWriterMethod // Assume the worst, that it is a writer method
                }
            }
        }

        return super.get(fake_target, key, receiver);


        var origMethod: ((this:unknown, ...args:unknown[]) => unknown) | undefined = undefined;
        /**
         * Fires a RecordedUnspecificRead
         */
        function trapForGenericReaderMethod(this:object, ...args: unknown[]) {
            const callResult = origMethod!.apply(receiverMustBeNonProxied?target:this, args); // call original method:
            thisHandler.fireAfterRead(new RecordedUnspecificRead());
            return callResult;
        }
        /**
         * Fires a RecordedUnspecificRead and calls the afterUnspecificWrite listeners
         * @param args
         */
        function trapForGenericReaderWriterMethod(this:object, ...args: unknown[]) {
            return runAndCallListenersOnce_after(target, (callListeners) => {
                const callResult = origMethod!.apply(receiverMustBeNonProxied?target:this, args); // call original method:
                callListeners(writeListenersForObject.get(target)?.afterUnspecificWrite); // Call listeners
                callListeners(writeListenersForObject.get(target)?.afterAnyWrite_listeners); // Call listeners
                thisHandler.fireAfterRead(new RecordedUnspecificRead());
                return callResult;
            });
        }
        /**
         * Wraps it in runAndCallListenersOnce_after
         * @param args
         */
        function trapHighLevelReaderWriterMethod(this:object, ...args: unknown[]) {
            return runAndCallListenersOnce_after(target, (callListeners) => {
                return origMethod!.apply(this, args);  // call original method
            });
        }
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

    protected rawChange(key: string | symbol, newUnproxiedValue: any) {
        runAndCallListenersOnce_after(this.target, (callListeners) => {
            const isNewProperty = getPropertyDescriptor(this.target, key) === undefined;
            super.rawChange(key, newUnproxiedValue);
            if(!objectIsEnhancedWithWriteTracker(this.target)) { // Listeners were not already called ?
                if(this.isForArray()) {
                    callListeners(writeListenersForObject.get(this.target)?.afterUnspecificWrite);
                }
                const writeListeners = writeListenersForObject.get(this.target);
                callListeners(writeListeners?.afterChangeSpecificProperty_listeners.get(key));
                callListeners(writeListeners?.afterChangeAnyProperty_listeners);
                if (isNewProperty) {
                    callListeners(writeListeners?.afterChangeOwnKeys_listeners);
                }
                callListeners(writeListeners?.afterAnyWrite_listeners);
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
                    callListeners(writeListenersForObject.get(this.target)?.afterAnyWrite_listeners);
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

    isForArray() {
        return Array.isArray(this.target)
    }

    isForSet() {
        return this.target instanceof Set;
    }

    isForMap() {
        return this.target instanceof Map;
    }
}





/**
 * Only counts on vs off calls for a quick alignment check
 */
export let debug_numberOfPropertyChangeListeners = 0;