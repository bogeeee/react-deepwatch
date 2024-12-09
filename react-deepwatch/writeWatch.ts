// This file has functions / classes that allow to watch writes to objects (or arrays/sets/maps) **without proxies**


import {AfterWriteListener, ObjKey, RecordedReadOnProxiedObject, WatchedGraphHandler} from "./watchedGraph";
import {MapSet} from "./Util";
import {WatchedArray} from "./WatchedArray";


type Clazz = {
    new(...args: unknown[]): unknown
}

/**
 * Register them here
 */
export const watcherClasses: Set<Clazz> = new Set([WatchedArray]);

/**
 * Maps the original class to the watcher class
 */
let cache_WatcherClassMap: Map<Clazz, Clazz> | undefined;

export function getWatcherClassFor(obj: object) {
    // lazy initialize
    if(cache_WatcherClassMap === undefined) {
        cache_WatcherClassMap = new Map([...watcherClasses].map(wc => [Object.getPrototypeOf(wc) as any, wc]));
    }

    const clazz = obj.constructor as Clazz;
    return cache_WatcherClassMap.get(clazz);
}

function objectIsEnhancedWithWatcher(obj: object) {
    return watcherClasses.has(obj.constructor as Clazz);
}

/**
 *
 * @param obj
 */
function enhanceWithWatcher(obj: object) {
    if(objectIsEnhancedWithWatcher(obj)) {
        return;
    }

    let watcherClass = getWatcherClassFor(obj);
    if(watcherClass !== undefined) {
        Object.setPrototypeOf(obj, watcherClass);
    }
}

/**
 *
 */
export class Supervisor<T> {
    /**
     * Contains these props/methods of T that are marked @writer
     */
    _writerProps: Partial<T> = {} as any;

    /**
     * @returns..., undefined, when this is the supervisor for the non-proxied object
     */
    get _watchedGraphHandler(): WatchedGraphHandler | undefined {
        throw new Error("TODO: either patched with the object");
        // or return superVisorToWatchedGraphWeakMap.get(this)
    }

    get _origMethods(): T {
        throw new Error("has the original methods and fields saved")
    }

    get _target():T {
        throw new Error("Should be patched with the object")
    }

    _fireAfterRead(read: RecordedReadOnProxiedObject) {
        this._watchedGraphHandler?.fireAfterRead(read);
    }
}

export class ObjectSupervisor extends Supervisor<object> {
    afterWriteOnPropertyListeners = new MapSet<ObjKey, AfterWriteListener>();
}

/**
 * Decorator
 * @param target
 * @param propertyKey
 * @param descriptor
 */
export function writer(target: Supervisor<unknown>, propertyKey: ObjKey, descriptor: PropertyDescriptor) {
    Object.defineProperty(target._writerProps, propertyKey, descriptor);
}