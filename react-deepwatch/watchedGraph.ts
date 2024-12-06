import {GraphProxyHandler, ProxiedGraph} from "./proxiedGraph";
import {arraysAreEqualsByPredicateFn, MapSet} from "./Util";
import _ from "underscore"

export type ObjKey = string | symbol;

type AfterReadListener = (read: RecordedRead) => void;
type AfterWriteListener = (value: unknown) => void;

export function watchable<T extends object>(obj: T): T {
    throw new Error("TODO");
}

const exclusiveWatchables = new WeakSet<object>();

/**
 * Like {@see watchable}: Makes obj watchable and returns the watchable proxy.
 * By the "x", you confirm that you will only ever use the proxy and **never use the original object**, to make writes on it.
 *
 * Therefore, adding properties to obj can always safely be watched.
 * @param obj
 */
export function xWatchable<T extends object>(obj: T): T {
    exclusiveWatchables.add(obj);
    return watchable(obj);
}

export function isXWatchable(obj: object) {
    return exclusiveWatchables.has(obj);
}


export abstract class RecordedRead {
    abstract equals(other: RecordedRead): boolean;

    abstract get isChanged(): boolean;

    abstract onChange(listener: (newValue: unknown) => void): void;

    abstract offChange(listener: (newValue: unknown) => void): void;

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

    onChange(listener: (newValue: unknown) => void) {
        throw new Error("Cannot listen for changes on simple value (not on object)");
    }

    offChange(listener: (newValue: unknown) => void) {
    }

    equals(other: RecordedRead) {
        if(! (other instanceof RecordedValueRead)) {
            return false;
        }

        return this.value === other.value;
    }
}

export class RecordedPropertyRead extends RecordedRead{
    proxyHandler?: WatchedGraphHandler
    /**
     * A bit redundant with proxyhandler. But for performance reasons, we leave it
     */
    obj!: object;
    key!: ObjKey;
    value!: unknown;

    constructor() {
        super();
    }

    get isChanged() {
        //@ts-ignore
        return this.obj[this.key] !== this.value;
    }

    onChange(listener: (newValue: unknown) => void) {
        if(!this.proxyHandler) {
            throw new Error("TODO");
        }
        else {
            this.proxyHandler.afterWriteOnPropertyListeners.add(this.key, listener);
            debug_numberOfPropertyChangeListeners++;
        }
    }

    offChange(listener: (newValue: unknown) => void) {
        if(!this.proxyHandler) {
            throw new Error("TODO");
        }
        else {
            this.proxyHandler.afterWriteOnPropertyListeners.delete(this.key, listener);
            debug_numberOfPropertyChangeListeners--;
        }
    }

    equals(other: RecordedRead) {
        if(! (other instanceof RecordedPropertyRead)) {
            return false;
        }

        return this.proxyHandler === other.proxyHandler && this.obj === other.obj && this.key === other.key && this.value === other.value;
    }
}



/**
 * Use cases:
 * - record read + watch recorded for modifications. For re-render trigger
 * - record read and make several snapshots (when load is called) and compare exactly those reads
 */
export class WatchedGraph extends ProxiedGraph<WatchedGraphHandler> {
    // *** Configuration: ***
    protected graphProxyHandlerConstructor = WatchedGraphHandler

    /**
     * Watches also writes that are not made through a proxy of this WatchedGraph by installing a setter (property accessor) on each of the desired properties
     * Works only for **individual** properties which you are explicitly listening on, and not on the whole Graph.
     * See {@link onAfterWrite} for the listener
     *
     */
    public watchWritesFromOutside = false; //

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
     * @param obj
     * @param key Not restricted here (for the tests), but it must not be number !
     * @param listener
     */
    onAfterWriteOnProperty<O extends  object, K extends keyof O>(obj: O, key: K, listener:  AfterWriteListener) {
        if(this.watchWritesFromOutside) {
            throw new Error("TODO");
        }
        else {
            this.getHandlerFor(obj).afterWriteOnPropertyListeners.add(key as ObjKey, listener);
        }

    }

    /**
     * Watches for writes on a specified property
     * @param obj
     * @param key Not restricted here (for the tests), but it must not be number !
     * @param listener
     */
    offAfterWriteOnProperty<O extends  object, K extends keyof O>(obj: O, key: K, listener:  AfterWriteListener) {
        if(this.watchWritesFromOutside) {
            throw new Error("TODO");
        }
        else {
            this.getHandlerFor(obj).afterWriteOnPropertyListeners.delete(key as ObjKey, listener);
        }
    }



}

class WatchedGraphHandler extends GraphProxyHandler<WatchedGraph> {
    afterWriteOnPropertyListeners = new MapSet<ObjKey, AfterWriteListener>();

    constructor(target: object, graph: WatchedGraph) {
        super(target, graph);
    }

    // TODO: implement afterRead and afterWrite listeners
    rawRead(key: ObjKey) {
        const result = super.rawRead(key);

        // Create the RecordedPropertyRead:
        let read = new RecordedPropertyRead();
        read.proxyHandler = this;
        read.obj = this.target;
        read.key = key;
        read.value = result;

        this.graph._afterReadListeners.forEach(l => l(read)); // Inform listeners

        return result;
    }

    protected rawWrite(key: string | symbol, newValue: any) {
        super.rawWrite(key, newValue);
        this.afterWriteOnPropertyListeners.get(key)?.forEach(l => l(newValue));
    }
}

/**
 * Only counts on vs off calls for a quick alignment check
 */
export let debug_numberOfPropertyChangeListeners = 0;