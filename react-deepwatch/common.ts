import {RecordedRead} from "./watchedGraph";
import {throwError, read} from "./Util";

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

export type WriteTrackerClass = Clazz & {knownHighLevelMethods: Set<ObjKey>, readOnlyMethods: Set<ObjKey>, readOnlyFields: Set<ObjKey>, receiverMustBeNonProxied: boolean};

let esRuntimeBehaviourAlreadyChecked = false;

export function checkEsRuntimeBehaviour() {
    if(esRuntimeBehaviourAlreadyChecked) {
        return;
    }
    // **************************************************************************************************
    // **** The following code is generated via `npm run dev:generateEsRuntimeBehaviourCheckerCode`: ****
    // **************************************************************************************************
    expectUsingMethodsOrFields(["a"], v=>v.at(0), ["at","length","0"])
    expectUsingMethodsOrFields(["a","b","c"], v=>v.concat("d","e","f"), ["concat","constructor",Symbol.isConcatSpreadable,"length","0","1","2"])
    expectUsingMethodsOrFields(["a","b","c"], v=>v.map(x=>read(x)), ["map","length","constructor","0","1","2"])
    expectUsingMethodsOrFields(["a","b","c"], v=>v.forEach(x=>read(x)), ["forEach","length","0","1","2"])
    expectUsingMethodsOrFields(["a","b","c"], v=>v.join(","), ["join","length","0","1","2"])
    expectUsingMethodsOrFields(["a","b","c","d"], v=>v.slice(1,3), ["slice","length","constructor","1","2"])
    expectUsingMethodsOrFields(["a","b","c"], v=>v.some(x=>x==="a"), ["some","length","0"])
    expectUsingMethodsOrFields(["a","b","c"], v=>v.filter(x=>x==="a"), ["filter","length","constructor","0","1","2"])
    expectUsingMethodsOrFields(["a","b","c"], v=>v.find(x=>x==="a"), ["find","length","0"])
    expectUsingMethodsOrFields(["a","b","c"], v=>v.every(x=>x==="a"), ["every","length","0","1"])
    expectUsingMethodsOrFields(["a","b","c"], v=>v.findIndex(x=>x==="a"), ["findIndex","length","0"])
    expectUsingMethodsOrFields(["a","b","c"], v=>v.includes("b",1), ["includes","length","1"])
    expectUsingMethodsOrFields(["a","b","c"], v=>v.indexOf("b",1), ["indexOf","length","1"])
    expectUsingMethodsOrFields(["a","b","c"], v=>v[Symbol.iterator]().next(), [Symbol.iterator,"length","0"])
    expectUsingMethodsOrFields(["a","b","b"], v=>v.lastIndexOf("b",1), ["lastIndexOf","length","1"])
    expectUsingMethodsOrFields(["a","b","b"], v=>v.reduce((p,c)=>p+c), ["reduce","length","0","1","2"])
    expectUsingMethodsOrFields(["a","b","b"], v=>v.reduceRight((p,c)=>p+c), ["reduceRight","length","2","1","0"])
    expectUsingMethodsOrFields(["a","b","b"], v=>v.toLocaleString(), ["toLocaleString","length","0","1","2"])
    expectUsingMethodsOrFields(["a","b","b"], v=>v.toString(), ["toString","join","length","0","1","2"])
    expectUsingMethodsOrFields(["a","b","c"], v=>v.unshift("_a","_b"), ["length","2","1","0"])
    expectUsingMethodsOrFields(["a","b","c","d"], v=>v.splice(1,2,"newB","newC","newX"), ["length","1","2","3"])
    expectUsingMethodsOrFields(["a","b","c","d"], v=>v.copyWithin(3,1,3), ["length","1","0","2","3"])
    expectUsingMethodsOrFields(["a","b","c","d"], v=>v.reverse(), ["length","0","3","1","2"])




    // **************************************************************************************************
    // **************************************************************************************************
    // **************************************************************************************************

    function expectUsingMethodsOrFields<T extends object>(orig: T, tester: (orig: T) => void,  expectedMethodsOrFields: Array<string | symbol> ) {
        // Run the tester and record used methods/fields:
        const usedMethodsOrFields = new Set<string | symbol>();
        const proxy = new Proxy(orig, {
            get(target: T, p: string | symbol, receiver: any): any {
                usedMethodsOrFields.add(p)
                //@ts-ignore
                return target[p];
            }
        })
        read(tester(proxy));

        !expectedMethodsOrFields.some(mf => mf !== "constructor" && !usedMethodsOrFields.has(mf)) || throwError(new Error(`The javascript runtime is not behaving as expected. Please report this as a bug along with your javascript runtime (or Browser) version`))
    }
    esRuntimeBehaviourAlreadyChecked = true;
}