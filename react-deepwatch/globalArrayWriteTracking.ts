import {AfterWriteListener, DualUseTracker} from "./common";


/**
 * Listeners for one array
 */
class ArrayWriteListeners {
    afterUnspecificWrite = new Set<AfterWriteListener>
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


    // TODO: In the future, implement more fine granular change listeners that act on change of a certain index.


    protected _fireAfterUnspecificWrite() {
        writeListenersForArray.get(this._target)?.afterUnspecificWrite.forEach(l => l(this._target));
    }

    forEach(...args: any[]) {
        try {
            return super.forEach.apply(this, args as any); // this.values.forEach(...args). Call it on values because the
        }
        finally {
            this._fireAfterUnspecificWrite();
        }
    }

    push(...items: any[]): number {
        try {
            return super.push(...items as any);
        }
        finally {
            this._fireAfterUnspecificWrite();
        }
    }

    /**
     * Will return the original object when this class is used as supervisor class in the WatchedGraphHandler
     */
    get _target(): Array<T> {
        return this;
    }


}