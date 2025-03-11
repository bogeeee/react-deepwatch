import {AfterWriteListener, DualUseTracker, ObjKey, runAndCallListenersOnce_after} from "./common";
import {throwError} from "./Util";
import {writeListenersForObject} from "./globalObjectWriteTracking";


/**
 * Listeners for one array.
 * Note for specificity: There will be only one of the **change** events fired. The Recorded...Read.onChange handler will add the listeners to all possible candidates. It's this way around.
 * {@link ObjectWriteListeners} are also subscribed on Arrays
 */
class ArrayWriteListeners {

}

export const writeListenersForArray = new WeakMap<unknown[], ArrayWriteListeners>();
export function getWriteListenersForArray(array: unknown[]) {
    let result = writeListenersForArray.get(array);
    if(result === undefined) {
        writeListenersForArray.set(array, result = new ArrayWriteListeners());
    }
    return result;
}

/**
 * Can be either used as a supervisor-class in a WatchedGraphHandler, or installed on the non-proxied object via Object.setPrototypeOf
 * The "this" may be different in these cases.
 */
export class WriteTrackedArray<T> extends Array<T> implements DualUseTracker<Array<T>>{
    /**
     * Built-in Methods, which are using fields / calling methods on the proxy transparently/loyally, so those methods don't call/use internal stuff directly.
     * Tested with, see dev_generateEsRuntimeBehaviourCheckerCode.ts
     * May include read-only / reader methods
     */
    static knownHighLevelMethods = new Set<keyof Array<unknown>>(["at", "concat", "map", "forEach", "join", "slice", "some", "filter", "find", "every", "findIndex", "includes", "indexOf", Symbol.iterator, "lastIndexOf", "push", "reduce", "reduceRight", "toLocaleString", "toString", "unshift", "splice", "copyWithin", "reverse"]) as Set<ObjKey>;

    /**
     * Non-high level. These fire `RecordedUnspecificRead`s then. So better implement them instead to fire i.e RecordedArrayValuesRead.
     */
    static readOnlyMethods = new Set<keyof Array<unknown>>(["keys" /* TODO: Implement .keys, mind, that it is different to RecordedOwnKeysRead which allows gaps*/]) as Set<ObjKey>;

    /**
     * Non-high level. Same as above: better implement them
     */
    static readOnlyFields = new Set<keyof Array<unknown>>([Symbol.unscopables]) as Set<ObjKey>;

    /**
     * Default, if not listed as high-level method
     */
    static receiverMustBeNonProxied = false;

    // TODO: In the future, implement more fine granular change listeners that act on change of a certain index.


    protected _fireAfterUnspecificWrite() {
        runAndCallListenersOnce_after(this._target, (callListeners) => {
            callListeners(writeListenersForObject.get(this._target)?.afterUnspecificWrite);
            callListeners(writeListenersForObject.get(this._target)?.afterAnyWrite_listeners);
        });
    }

    //push(...items: any[]): number //already calls set

    pop(...args: any[]) {
        //@ts-ignore
        const result = super.pop(...args);
        this._fireAfterUnspecificWrite();
        return result;
    }

    /**
     * Will return the original object when this class is used as supervisor class in the WatchedGraphHandler
     */
    get _target(): Array<T> {
        return this;
    }

    /**
     * Pretend that this is an array
     */
    get ["constructor"]() {
        return Array;
    }

    shift(...args: any[]): T | undefined {
        //@ts-ignore
        const result = super.shift(...args);
        this._fireAfterUnspecificWrite();
        return result;
    }

    //@ts-ignore
    sort(...args: any[]): Array<T> {
        //@ts-ignore
        const result = super.sort(...args);
        this._fireAfterUnspecificWrite();
        return result;
    }


    //@ts-ignore
    fill(...args: any[]): Array<T> {
        //@ts-ignore
        const result = super.fill(...args);
        this._fireAfterUnspecificWrite();
        return result;
    }

}