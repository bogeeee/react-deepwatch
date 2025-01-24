import {RecordedRead} from "./watchedGraph";

export type ObjKey = string | symbol;
export type AfterReadListener = (read: RecordedRead) => void;
export type AfterWriteListener = () => void;
export type AfterChangeOwnKeysListener = () => void;
export type Clazz = {
    new(...args: any[]): unknown
}

/**
 * For use in proxy and direct
 */
export interface DualUseTracker<T> {
    /**
     * The original (unproxied) object
     */
    get _target(): T
}

/**
 * Like Object.getOwnPropertyDescriptor. But for all parent classes
 * @param o
 * @param p
 */
export function getPropertyDescriptor(o: object, p: PropertyKey):  PropertyDescriptor | undefined {
    let result = Object.getOwnPropertyDescriptor(o, p);
    if(result !== undefined) {
        return result;
    }
    let proto = Object.getPrototypeOf(o);
    if(proto !== null) {
        return getPropertyDescriptor(proto, p);
    }
}

export type GetterFlags = {
    origHadGetter?: boolean
}
export type SetterFlags = {
    origHadSetter?: boolean
}

const runAndCallListenersOnce_after_listeners = new Map<object, Set<() => void>>();

/**
 * Prevents listeners from beeing called twice. Even during the same operation that spans a call stack.
 * Runs the collectorFn, which can add listeners to the listenersSet. These are then fired *after* collectorFn has run.
 * If this function gets called nested (for the same target) / "spans a call stack", then only after the outermost call will *all* deep collected listeners be fired.
 * <p>
 *     This function is needed, because there's some overlapping of concerns in listener types, especially for Arrays. Also internal methods may again call the set method which itsself wants to call the propertychange_listeners.
 * </p>
 * @param collectorFn
 */
export function runAndCallListenersOnce_after<R>(forTarget: object, collectorFn: (callListeners: (listeners?: (() => void)[] | Set<() => void>) => void) => R) {
    let listenerSet = runAndCallListenersOnce_after_listeners.get(forTarget);
    let isRoot = false; // is it not nested / the outermost call ?
    if(listenerSet === undefined) {
        isRoot = true;
        runAndCallListenersOnce_after_listeners.set(forTarget, listenerSet = new Set()); // Create and register listener set
    }

    try {
        const result = collectorFn((listeners) => {listeners?.forEach(l => listenerSet?.add(l))});

        if(isRoot) {
            // call listeners:
            for (const listener of listenerSet.values()) {
                listener();
            }
        }

        return result;
    }
    finally {
        if (isRoot) {
            runAndCallListenersOnce_after_listeners.delete(forTarget);
        }
    }
}

