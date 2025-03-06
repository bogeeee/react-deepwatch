import {AfterWriteListener, DualUseTracker, ObjKey, runAndCallListenersOnce_after} from "./common";
import {writeListenersForObject} from "./globalObjectWriteTracking";
import {MapSet} from "./Util";


/**
 * Listeners for one set.
 * Note for specificity: There will be only one of the **change** events fired. The Recorded...Read.onChange handler will add the listeners to all possible candidates. It's this way around.
 * {@link ObjectWriteListeners} are also subscribed on Sets
 */
class SetWriteListeners {
    afterSpecificValueChanged = new MapSet<unknown, AfterWriteListener>();
    afterAnyValueChanged = new Set<AfterWriteListener>();
}

export const writeListenersForSet = new WeakMap<Set<unknown>, SetWriteListeners>();
export function getWriteListenersForSet(set: Set<unknown>) {
    let result = writeListenersForSet.get(set);
    if(result === undefined) {
        writeListenersForSet.set(set, result = new SetWriteListeners());
    }
    return result;
}

/**
 * Can be either used as a supervisor-class in a WatchedGraphHandler, or installed on the non-proxied object via Object.setPrototypeOf
 * The "this" may be different in these cases.
 */
export class WriteTrackedSet<T> extends Set<T> implements DualUseTracker<Set<T>>{

    /**
     * Built-in Methods, which are using fields / calling methods on the proxy transparently/loyally, so those methods don't call/use internal stuff directly.
     * Tested with, see dev_generateEsRuntimeBehaviourCheckerCode.ts
     * May include read-only / reader methods
     */
    static knownHighLevelMethods = new Set<keyof Set<unknown>>([]) as Set<ObjKey>;

    /**
     * Non-high level
     */
    static readOnlyMethods = new Set<keyof Set<unknown>>([]) as Set<ObjKey>;

    /**
     * Non-high level
     */
    static readOnlyFields = new Set<keyof Set<unknown>>(["size"]) as Set<ObjKey>;

    /**
     * Default, if not listed as high-level method
     */
    static receiverMustBeNonProxied = true;


    protected _fireAfterUnspecificWrite() {
        runAndCallListenersOnce_after(this._target, (callListeners) => {
            callListeners(writeListenersForObject.get(this._target)?.afterUnspecificWrite);
            callListeners(writeListenersForObject.get(this._target)?.afterAnyWrite_listeners);
        });
    }

    /**
     * Will return the original object when this class is used as supervisor class in the WatchedGraphHandler
     */
    get _target(): Set<T> {
        return this;
    }

    /**
     * Pretend that this is a Set
     */
    get ["constructor"]() {
        return Set;
    }

    add(value:T): this {
        if(this._target.has(value)) { // No change?
            return this;
        }
        runAndCallListenersOnce_after(this._target, (callListeners) => {
            const result = Set.prototype.add.apply(this._target, [value]); // this.add(value); receiver for .add must be the real/nonproxied Set
            callListeners(writeListenersForSet.get(this._target)?.afterSpecificValueChanged.get(value));
            callListeners(writeListenersForSet.get(this._target)?.afterAnyValueChanged);
            callListeners(writeListenersForObject.get(this._target)?.afterAnyWrite_listeners);
        });
        return this;
    }

    delete(value: T): boolean {
        const result = Set.prototype.delete.apply(this._target, [value]); // this.delete(value); receiver for .delete must be the real/nonproxied Set
        if(result) { // deleted?
            runAndCallListenersOnce_after(this._target, (callListeners) => {
                callListeners(writeListenersForSet.get(this._target)?.afterSpecificValueChanged.get(value));
                callListeners(writeListenersForSet.get(this._target)?.afterAnyValueChanged);
                callListeners(writeListenersForObject.get(this._target)?.afterAnyWrite_listeners);
            });
        }
        return result
    }

    clear() {
        runAndCallListenersOnce_after(this._target, (callListeners) => {
            Set.prototype.clear.apply(this._target, []); // this.clear(); receiver for .clear must be the real/nonproxied Set
            callListeners(writeListenersForSet.get(this._target)?.afterAnyValueChanged);
            callListeners(writeListenersForObject.get(this._target)?.afterUnspecificWrite);
            callListeners(writeListenersForObject.get(this._target)?.afterAnyWrite_listeners);
        });
    }

}