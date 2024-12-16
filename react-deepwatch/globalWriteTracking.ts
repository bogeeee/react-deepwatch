// This file has functions / classes that allow to watch writes to objects (or arrays/sets/maps) **without proxies**


import {RecordedReadOnProxiedObject, WatchedGraphHandler} from "./watchedGraph";
import {MapSet} from "./Util";
import {WriteTrackedArray} from "./globalArrayWriteTracking";
import {AfterWriteListener, Clazz, ObjKey} from "./common";
import {ObjectProxyHandler} from "./globalObjectWriteTracking";


const enhancedObjects = new WeakSet<object>();

/**
 * Register them here
 */
export const writeTrackerClasses: Set<Clazz> = new Set([WriteTrackedArray]);

/**
 * Maps the original class to the watcher class
 */
let cache_WriteTrackerClassMap: Map<Clazz, Clazz> | undefined;

export function getWriteTrackerClassFor(obj: object) {
    // lazy initialize
    if(cache_WriteTrackerClassMap === undefined) {
        cache_WriteTrackerClassMap = new Map([...writeTrackerClasses].map(wc => [Object.getPrototypeOf(wc) as any, wc]));
    }

    const clazz = obj.constructor as Clazz;
    return cache_WriteTrackerClassMap.get(clazz);
}

export function objectIsEnhancedWithWriteTracker(obj: object) {
    return enhancedObjects.has(obj);
}

/**
 *
 * @param obj
 */
export function enhanceWithWriteTracker(obj: object) {
    if(objectIsEnhancedWithWriteTracker(obj)) {
        return;
    }

    let watcherClass = getWriteTrackerClassFor(obj);
    if(watcherClass !== undefined) {
        Object.setPrototypeOf(obj, watcherClass.prototype);
    }
    else {
        const proxy = new ObjectProxyHandler(obj).proxy;
        Object.setPrototypeOf(obj, proxy);
    }
    enhancedObjects.add(obj);
}
