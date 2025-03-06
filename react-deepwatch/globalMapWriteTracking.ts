import {AfterWriteListener, DualUseTracker, ObjKey, runAndCallListenersOnce_after} from "./common";
import {writeListenersForObject} from "./globalObjectWriteTracking";
import {MapSet} from "./Util";


/**
 * Listeners for one map.
 * Note for specificity: There will be only one of the **change** events fired. The Recorded...Read.onChange handler will add the listeners to all possible candidates. It's this way around.
 * {@link ObjectWriteListeners} are also subscribed on Maps
 */
class MapWriteListeners {
    afterSpecificKeyAddedOrRemoved = new MapSet<unknown, AfterWriteListener>();
    afterAnyKeyAddedOrRemoved = new Set<AfterWriteListener>();

    afterSpecificValueChanged = new MapSet<unknown, AfterWriteListener>();
    afterAnyValueChanged = new Set<AfterWriteListener>();
}

export const writeListenersForMap = new WeakMap<Map<unknown,unknown>, MapWriteListeners>();
export function getWriteListenersForMap(map: Map<unknown,unknown>) {
    let result = writeListenersForMap.get(map);
    if(result === undefined) {
        writeListenersForMap.set(map, result = new MapWriteListeners());
    }
    return result;
}

/**
 * Can be either used as a supervisor-class in a WatchedGraphHandler, or installed on the non-proxied object via Object.setPrototypeOf
 * The "this" may be different in these cases.
 */
export class WriteTrackedMap<K,V> extends Map<K,V> implements DualUseTracker<Map<K,V>>{

    /**
     * Built-in Methods, which are using fields / calling methods on the proxy transparently/loyally, so those methods don't call/use internal stuff directly.
     * Tested with, see dev_generateEsRuntimeBehaviourCheckerCode.ts
     * May include read-only / reader methods
     */
    static knownHighLevelMethods = new Set<keyof Map<unknown,unknown>>([]) as Set<ObjKey>;

    /**
     * Non-high level
     */
    static readOnlyMethods = new Set<keyof Map<unknown,unknown>>([]) as Set<ObjKey>;

    /**
     * Non-high level
     */
    static readOnlyFields = new Set<keyof Map<unknown,unknown>>(["size"]) as Set<ObjKey>;

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
    get _target(): Map<K, V> {
        return this;
    }

    /**
     * Pretend that this is a Map
     */
    get ["constructor"]() {
        return Map;
    }

    set(key:K, value: V): this {
        const isNewKey = !this._target.has(key);
        const valueChanged = isNewKey || this._target.get(key) !== value;
        if(!isNewKey && !valueChanged) {
            return this;
        }

        runAndCallListenersOnce_after(this._target, (callListeners) => {
            const result = Map.prototype.set.apply(this._target, [key, value]); // this.set(key, value); receiver for .set must be the real/nonproxied Map
            if(isNewKey) {
                callListeners(writeListenersForMap.get(this._target)?.afterSpecificKeyAddedOrRemoved.get(key));
                callListeners(writeListenersForMap.get(this._target)?.afterAnyKeyAddedOrRemoved);
            }

            if(valueChanged) {
                callListeners(writeListenersForMap.get(this._target)?.afterSpecificValueChanged.get(key));
                callListeners(writeListenersForMap.get(this._target)?.afterAnyValueChanged);
            }

            callListeners(writeListenersForObject.get(this._target)?.afterAnyWrite_listeners);
        });
        return this;
    }

    delete(key: K): boolean {
        const result = Map.prototype.delete.apply(this._target, [key]); // this.delete(key); receiver for .delete must be the real/nonproxied Map
        if(result) { // deleted?
            runAndCallListenersOnce_after(this._target, (callListeners) => {
                callListeners(writeListenersForMap.get(this._target)?.afterSpecificKeyAddedOrRemoved.get(key));
                callListeners(writeListenersForMap.get(this._target)?.afterAnyKeyAddedOrRemoved);
                callListeners(writeListenersForMap.get(this._target)?.afterSpecificValueChanged.get(key));
                callListeners(writeListenersForMap.get(this._target)?.afterAnyValueChanged);
                callListeners(writeListenersForObject.get(this._target)?.afterAnyWrite_listeners);
            });
        }
        return result
    }

    clear() {
        runAndCallListenersOnce_after(this._target, (callListeners) => {
            Map.prototype.clear.apply(this._target, []); // this.clear(); receiver for .clear must be the real/nonproxied Map
            callListeners(writeListenersForMap.get(this._target)?.afterAnyKeyAddedOrRemoved);
            callListeners(writeListenersForMap.get(this._target)?.afterAnyValueChanged);
            callListeners(writeListenersForObject.get(this._target)?.afterUnspecificWrite);
            callListeners(writeListenersForObject.get(this._target)?.afterAnyWrite_listeners);
        });
    }

}