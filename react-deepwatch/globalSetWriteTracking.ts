import {AfterWriteListener, DualUseTracker} from "./common";


/**
 * Listeners for one set.
 * Note for specificity: There will be only one of the **change** events fired. The Recorded...Read.onChange handler will add the listeners to all possible candidates. It's this way around.
 * {@link ObjectWriteListeners} are also subscribed on Sets
 */
class SetWriteListeners {
    afterUnspecificWrite = new Set<AfterWriteListener>
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


    // TODO: In the future, implement more fine granular change listeners that act on change of a certain index.


    protected _fireAfterUnspecificWrite() {
        writeListenersForSet.get(this._target)?.afterUnspecificWrite.forEach(l => l());
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

}