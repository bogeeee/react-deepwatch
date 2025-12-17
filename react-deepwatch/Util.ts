import {RecordedRead} from "proxy-facades";

export function throwError(e: string | Error) {
    if(e !== null && e instanceof Error) {
        throw e;
    }
    throw new Error(e);
}

export function reThrowWithHint(e: unknown, hint: string) {
    try {
        if(e instanceof Error) {
            // Add hint to error:
            e.message+= `\n${hint}`;
        }
    }
    catch (x) {
    }
    throw e;
}

export function errorToString(e: any): string {
    try {
        // Handle other types:
        if (!e || typeof e !== "object") {
            return String(e);
        }
        if (!e.message) { // e is not an ErrorWithExtendedInfo ?
            return JSON.stringify(e);
        }
        e = e as Error;

        return (e.name ? `${e.name}: ` : "") + (e.message || String(e)) +
            (e.stack ? `\n${e.stack}` : '') +
            (e.fileName ? `\nFile: ${e.fileName}` : '') + (e.lineNumber ? `, Line: ${e.lineNumber}` : '') + (e.columnNumber ? `, Column: ${e.columnNumber}` : '') +
            (e.cause ? `\nCause: ${errorToString(e.cause)}` : '')
    }
    catch (e) {
        return errorToString(new Error(`Error converting error to string. Original error's message: ${(e as any)?.message}`));
    }
}

/**
 * When running with jest, the cause is not displayed. This fixes it.
 * @param error
 */
export function fixErrorForJest(error: Error) {
    if(typeof process === 'object' && process.env.JEST_WORKER_ID !== undefined) { // Are we running with jest ?
        const cause = (error as any).cause;
        if(cause) {
            error.message = `${error.message}, cause: ${errorToString(cause)}\n*** end of cause ***`
        }
    }
    return error;
}



/**
 * Globally control diagnosis settings
 */
export const ErrorDiagnosis = {
    /**
     * Disabled by default, cause it might cost too much time
     */
    record_spawnAsync_stackTrace: false,
}

function toplevelLogError(caught: unknown) {
    console.error(caught);
}

/**
 * Handles top level Errors, with advanced global options for error diagnosis
 * @see ErrorDiagnosis
 * @param fn
 * @param exitOnError produces an unhandled- rejection which exits the (nodejs) process.
 */
export function topLevel_withErrorLogging(fn: () => void, exitOnError = true) {
    try {
        fn();
    }
    catch (e) {
        toplevelLogError(e);
    }
}

/**
 * Spawns fn and handles top level Errors, with advanced global options for error diagnosis
 * @see ErrorDiagnosis
 * @param fn
 * @param exitOnError for compatibility with nodejs
 */
export function spawnAsync(fn: () => Promise<void>, exitOnError = false) {

    let spawnStack: string | undefined
    if (ErrorDiagnosis.record_spawnAsync_stackTrace) {
        spawnStack = new Error("Dummy error, to record creator stack").stack;
    }

    const promise = fn();
    promise.catch((caught) => {

        if(spawnStack) {
            // Fix spawnStack:
            spawnStack = spawnStack.replace(/^.*Dummy error, to record creator stack.*?\n/, ""); // remove that confusing line

            if (caught instanceof Error) {
                caught.stack = `${caught.stack}\n*** spawnAsync stack: ***\n${spawnStack}`
            } else {
                caught = fixErrorForJest(new Error(`Promise was rejected.\n${spawnStack}\n*** ignore this following stack and skip to 'reason' ****`, {cause: caught}));
            }
        }
        else {
            // Add hint:
            const hint = `Hint: if the stacktrace does not show you the place, where the async is forked, do: import {ErrorDiagnosis} from 'util'; ErrorDiagnosis.record_spawnAsync_stackTrace=true;`
            if (caught instanceof Error) {
                caught.message+="\n" +  hint;
            } else {
                caught = fixErrorForJest(new Error(`Promise was rejected. ${hint}`, {cause: caught}));
            }
        }

        toplevelLogError(caught);
    });
}

export function isObject(value: unknown) {
    return value !== null && typeof value === "object";
}

/**
 * A Map<K, Set<V>>. But automatically add a new Set if needed
 */
export class MapSet<K, V> {
    map = new Map<K, Set<V>>()

    add(key: K, value: V) {
        let set = this.map.get(key);
        if(set === undefined) {
            set = new Set<V>();
            this.map.set(key, set);
        }
        set.add(value);
    }

    delete(key: K, value: V) {
        let set = this.map.get(key);
        if(set !== undefined) {
            set.delete(value);
            if(set.size === 0) {
                this.map.delete(key); // Clean up
            }
        }
    }

    get(key: K) {
        return this.map.get(key);
    }
}

/**
 * A WeakMap<K, Set<V>>. But automatically add a new Set if needed
 */
export class WeakMapSet<K extends WeakKey, V> extends MapSet<K, V> {
    map = new WeakMap<K, Set<V>>() as Map<K, Set<V>>;
}

export function arraysAreEqualsByPredicateFn<A, B>(a: A[], b: B[], equalsFn: (a: A,b: B) => boolean) {
    if(a.length !== b.length) {
        return false;
    }
    for(const k in a) {
        if(!equalsFn(a[k], b[k])) {
            return false;
        }
    }
    return true;
}
export type PromiseState<T> = {state: "pending", promise: Promise<T>} | {state: "resolved", resolvedValue: T} | {state: "rejected", rejectReason: any};


type VisitReplaceContext = {
    /**
     * Not safely escaped. Should be used for diag only !
     */
    diagnosis_path?: string

    parentObject?: object
    key?: unknown
}

function diagnosis_jsonPath(key: unknown) {
    if(!Number.isNaN(Number(key))) {
        return `[${key}]`;
    }
    return `.${key}`;
}

/**
 * Usage:
 *  <pre><code>
 *  const result = visitReplace(target, (value, visitChilds, context) => {
 *      return value === 'needle' ? 'replaced' : visitChilds(value, context)
 *  });
 *  </code></pre>
 *
 * @param value
 * @param visitor
 * @param trackPath whether to pass on the context object. This hurts performance because the path is concatted every time, so use it only when needed. Setting this to "onError" re-executes the visitprelace with the concetxt when an error was thrown
 */
export function visitReplace<O>(value: O, visitor: (value: unknown, visitChilds: (value: unknown, context: VisitReplaceContext) => unknown, context: VisitReplaceContext) => unknown , trackPath: boolean | "onError" = false): O {
    const visisitedObjects = new Set<object>()

    function visitChilds(value: unknown, context: VisitReplaceContext) {
        if(value === null) {
            return value;
        }
        else if(typeof value === "object") {
            const obj = value as object;
            if(visisitedObjects.has(obj)) {
                return value; // don't iterate again
            }
            visisitedObjects.add(obj);

            for (let k in obj) {
                const keyInParent = k as keyof object;
                const childValue = obj[keyInParent];
                let newValue = visitor(childValue, visitChilds, {...context, parentObject: value, key: keyInParent, diagnosis_path: (context.diagnosis_path !== undefined?`${context.diagnosis_path!}${diagnosis_jsonPath(keyInParent)}`:undefined)});
                if(newValue !== childValue) { // Only if childValue really has changed. We don't want to interfer with setting a readonly property and trigger a proxy
                    // @ts-ignore
                    obj[keyInParent] = newValue;
                }
            }
        }
        return value;
    }

    if(trackPath === "onError") {
        try {
            return visitor(value,  visitChilds, {}) as O; // Fast try without context
        }
        catch (e) {
            return visitReplace(value,  visitor, true); // Try again with context
        }
    }

    return visitor(value, visitChilds,{diagnosis_path: trackPath?"":undefined}) as O;
}

/**
 * Just do something the runtime can't optimize away
 * @param value
 */
export function read(value: any) {
    if( ("" + value) == "blaaxyxzzzsdf" ) {
        throw new Error("should never get here")
    }
}

export function arraysAreShallowlyEqual(a: unknown[], b: unknown[]) {
    if(a.length !== b.length) {
        return false;
    }
    for(let i = 0;i<a.length;i++) {
        if(a[i] !== b[i]) {
            return false;
        }
    }
    return true;
}

/**
 * Like arraysAreShallowlyEqual but this time for an array of entries (tuple of 2 values) like from Map#entries()
 * @param a
 * @param b
 */
export function arraysWithEntriesAreShallowlyEqual(a: Array<[unknown, unknown]>, b: Array<[unknown, unknown]>) {
    if(a.length !== b.length) {
        return false;
    }
    for(let i = 0;i<a.length;i++) {
        if(a[i][0] !== b[i][0]) {
            return false;
        }
        if(a[i][1] !== b[i][1]) {
            return false;
        }
    }
    return true;
}

export function recordedReadsArraysAreEqual(a: RecordedRead[], b: RecordedRead[]) {
    return arraysAreEqualsByPredicateFn(a, b, (a, b) => a.equals(b));
}

/**
 * This Map does not return empty values, so there's always a default value created
 */
export abstract class DefaultMap<K, V> extends Map<K,V>{
    abstract createDefaultValue(): V;

    get(key: K): V {
        let result = super.get(key);
        if(result === undefined) {
            result = this.createDefaultValue();
            this.set(key, result);
        }
        return result;
    }
}

/**
 *
 * @param createDefaultValueFn
 * @returns a Map that creates and inserts a default value when that value does not exist. So the #get method always returns something.
 */
export function newDefaultMap<K,V>(createDefaultValueFn: () => V): DefaultMap<K, V> {
    return new class extends DefaultMap<K, V> {
        createDefaultValue(): V {
            return createDefaultValueFn();
        }
    }()
}

export function array_peekLast<T>(array: Array<T>): T | undefined {
    if(array.length === 0) {
        return undefined
    }
    return array[array.length-1];
}