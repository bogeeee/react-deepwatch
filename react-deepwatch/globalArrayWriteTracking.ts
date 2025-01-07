import {AfterWriteListener, DualUseTracker} from "./common";


/**
 * Listeners for one array.
 * Note for specificity: There will be only one of the **change** events fired. The Recorded...Read.onChange handler will add the listeners to all possible candidates. It's this way around.
 * {@link ObjectWriteListeners} are also subscribed on Arrays
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

    push(...items: any[]): number {

        const result = super.push(...items as any);
        this._fireAfterUnspecificWrite();
        return result;
    }

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

    reverse(...args: any[]): T[] {
        //@ts-ignore
        const result = super.reverse(...args);
        this._fireAfterUnspecificWrite();
        return result;
    }

    //@ts-ignore
    copyWithin(...args: any[]): Array<T> {
        //@ts-ignore
        const result = super.copyWithin(...args);
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

    splice(...args: any[]): T[] {
        //@ts-ignore
        const result = super.splice(...args);
        this._fireAfterUnspecificWrite();
        return result;
    }

    //@ts-ignore
    unshift(...items): number {
        const result = super.unshift(...items);
        this._fireAfterUnspecificWrite();
        return result;
    }
}