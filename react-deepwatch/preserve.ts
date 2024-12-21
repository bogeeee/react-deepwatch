import {v} from "vitest/dist/reporters-yx5ZTtEV";
import {visitReplace} from "./Util";
import _ from "underscore";
import {invalidateObject} from "./proxiedGraph";

const normalizeListsHint = `Hint: When this is fetched server data and having duplicate items in a list is intentional, you can pre-process it with the normalizeLists function first. See: import {normalizeLists, normalizeList} from "react-deepwatch"`

export type PreserveDiagnosis = {
    fromLoad?: boolean,
    callStack?: Error;
}

export type PreserveOptions = {
    /**
     * Invalidates those objects under newObj that have become obsolete, by installing a proxy on them that throws an a Error when trying to use them. This makes sure, your code does not accidentally use them.
     * <p>Default: true</p>
     */
    destroyObsolete?: boolean,

    /**
     * Ignores the "id" property and only uses the "key" property when re-identifying objects
     * <p>Default: false</p>
     */
    ignoresIds?: boolean,

    /**
     * Ignores the "key" property and only uses the "id" property when re-identifying objects
     * <p>Default: false</p>
     */
    ignoresKeys?: boolean,

    /**
     * Threats an object that was preserved and reoccurs on a completely differnt place (not the same parent) as the same = re-uses that instance.
     * <p>Default: false</p>
     * <p>Disabled by default because too much magic / behaviour flipping depending indirectly related data.</p>
     */
    preserveCircular?: boolean

    /**
     * Only for normalizeList(s) function
     */
    normalize_ignoreDifferent?: boolean
}

class PreserveCall {
    options: PreserveOptions;
    /**
     * preserved/old -> new (obsolete) object
     */
    mergedToNew = new Map<object,object>();

    /**
     * new (obsolete) object -> preserved/old object
     */
    newToPreserved = new Map<object,object>();

    possiblyObsoleteObjects = new Set<object>();

    usedObjects = new WeakSet<object>();

    /**
     *
     * @param value
     */
    markUsed(value: unknown) {
        if(value !== null && typeof value === "object") {
            this.usedObjects.add(value);
        }
    }

    diagnosis?: PreserveDiagnosis

    constructor(options: PreserveOptions, diagnosis?: PreserveDiagnosis) {
        this.options = options;
        this.diagnosis = diagnosis;
    }
}
type ID = string | number;

/**
 * Registry for objects in the **same** Array / Set / Map
 */
class ObjRegistry {
    preserveOptions: PreserveOptions;

    objectsById = new Map<ID, object>();
    objectsByKey = new Map<ID, object>();
    objectsByIdAndKey = new Map<string, object>();


    constructor(preserveOptions: PreserveOptions) {
        this.preserveOptions = preserveOptions;
    }

    getIdAndKey(obj: object, diagnosis_path: string): {id?: ID, key?: ID} {
        const diagnosis_getErrorDiag = () => `Trying to reidentify the object ${diagnisis_shortenValue(obj)} during a 'preserve' operation. Path: ${diagnosis_path}`;

        const result: {id?: ID, key?: ID} = {};

        for(const mode of [{propName: "id", map: this.objectsById, diag_other: this.objectsByKey}, {propName: "key", map: this.objectsByKey, diag_other: this.objectsById}]) {
            const throwInconsistent = (map: Map<ID, object>) => {throw new PreserveError(`Objects must be consistent in either having an id or a key or both set, but found: ${diagnisis_shortenValue(obj)} and ${diagnisis_shortenValue(map.values().next().value)}. Path: ${diagnosis_path}`)};

            //@ts-ignore
            const value = obj[mode.propName]
            if(value === undefined || value === null) {
                if(mode.map.size > 0) {
                    throwInconsistent(mode.map);
                }
                continue;
            }
            if(! (typeof value === "number" || typeof value === "string") ) {
                throw new PreserveError(`${mode.propName} must be a number or a string. ${diagnosis_getErrorDiag()}`);
            }

            // safety check:
            if(mode.map.size == 0 && mode.diag_other.size > 0) {
                throwInconsistent(mode.diag_other);
            }

            //@ts-ignore
            result[mode.propName] = value;
        }

        if(result.id === undefined && result.key === undefined) {
            throw new PreserveError(`Object has no id or key set. ${diagnosis_getErrorDiag()}. Please specify 'id' or 'key' property or both on your data objects when using them in an Array/Set/Map`);
        }

        return result as any;
    }

    register(value: unknown, diagnosis_path: string) {
        if (value === null || typeof value !== "object") { // not an object
            return;
        }

        let idAndKey = this.getIdAndKey(value, diagnosis_path);
        const idAndKeyString = this.idAndKeyToString(idAndKey);
        const existing = this.objectsByIdAndKey.get(idAndKeyString);
        if(existing !== undefined && existing !== value) {
            throw new PreserveError(`Multiple items in an array have the same id+key: ${diagnisis_shortenValue(idAndKey)}. Path: ${diagnosis_path}.\n${normalizeListsHint}`)
        }

        // Add to maps:
        this.objectsByIdAndKey.set(idAndKeyString, value);
        if(idAndKey.id !== undefined) {
            this.objectsById.set(idAndKey.id, value)
        }
        if(idAndKey.key !== undefined) {
            this.objectsByKey.set(idAndKey.key, value)
        }
    }

    get(value: object, diagnosis_path: string) {
        return this.objectsByIdAndKey.get(this.idAndKeyToString(this.getIdAndKey(value, diagnosis_path)));
    }

    getPreserved(newValue: unknown, call: PreserveCall, diagnosis_path: string) {
        if(newValue === undefined || newValue === null || typeof newValue !== "object") { // newValue is no object ?
            return newValue;
        }

        const existing = this.get(newValue, diagnosis_path);
        return preserve_inner(existing, newValue, call, diagnosis_path);
    }

    protected idAndKeyToString(ik: {id?: ID, key?: ID}) {
        return `${ik.id}_${ik.key}`;
    }
}

export function preserve<T>(oldValue: T, newValue: T, options: PreserveOptions = {}): T {
    return _preserve(oldValue, newValue, options);
}

export function _preserve<T>(oldValue: T, newValue: T, options: PreserveOptions, diagnosis?: PreserveDiagnosis): T {
    let call = new PreserveCall(options, diagnosis);
    let result = preserve_inner(oldValue, newValue, call, "<root>");

    // Invalidate obsolete objects
    if(options.destroyObsolete !== false && call.possiblyObsoleteObjects.size > 0) {
        const obsoleteCause = diagnosis?.callStack || new Error("Preserve was called");
        call.possiblyObsoleteObjects.forEach(obj => {
            if(call.usedObjects.has(obj)) {
                return;
            }
            try {
                invalidateObject(obj, "This object is obsolete. Another object is used in its place (which has all values copied to it =preserved), to keep constant object identities across data fetches. See cause. You can disable invalidation via the PreserveOptions#destroyObsolete flag.", obsoleteCause)
            }
            catch (e) {
                throw new Error("Error during invalidation. You should disable invalidation via the PreserveOptions#destroyObsolete flag", {cause: e});
            }
        });
    }
    return result;
}


export function preserve_inner<T>(oldValue: T, newValue: T, call: PreserveCall, diagnosis_path: string): T {
    const inner = () => {
        if (newValue === null || typeof newValue !== "object") {
            return newValue;
        }

        if (call.options.preserveCircular) {
            const preserved = call.newToPreserved.get(newValue);
            if (preserved !== undefined) {
                return preserved as T;
            }
        }

        if (!mergeable(oldValue, newValue)) {
            return newValue;
        }

        // Narrow types:
        if (oldValue === null || typeof oldValue !== "object" || newValue === null || typeof newValue !== "object") {
            return newValue;
        }


        if (call.mergedToNew.has(oldValue)) { // Already merged or currently merging?
            // Safety check:
            if (call.mergedToNew.get(oldValue) !== newValue) {
                throw new PreserveError(`Cannot replace object ${diagnisis_shortenValue(oldValue)} into ${diagnisis_shortenValue(newValue)} in: ${diagnosis_path}. It has already been replaced by another object: ${diagnisis_shortenValue(call.mergedToNew.get(oldValue))}. Please make your objects have a proper id or key and are not used in multiple places where these can be mistaken.\n${normalizeListsHint}`)
            }

            return oldValue;
        }

        // *** Merge: ****
        call.mergedToNew.set(oldValue, newValue);
        call.newToPreserved.set(newValue, oldValue);

        if (Array.isArray(oldValue)) {
            return preserve_array(oldValue as unknown[], newValue as unknown[], call, diagnosis_path) as T;
        } else if (oldValue instanceof Set) {
            return preserve_set(oldValue, newValue as any, call, diagnosis_path) as T;
        } else if (oldValue instanceof Map) {
            return preserve_map(oldValue, newValue as any, call, diagnosis_path) as T;
        } else { // Plain objects (or class instances) ?
            // ** merge objects **
            // add new values:
            for (const key of [...Object.getOwnPropertyNames(newValue), ...Object.getOwnPropertySymbols(newValue)]) { // iterate own keys of newValue
                //@ts-ignore
                oldValue[key] = preserve_inner(oldValue[key], newValue[key], call, diagnosis_path + diagnosis_jsonPath(key));
            }

            // remove keys not in newValue:
            for (const key of [...Object.getOwnPropertyNames(oldValue), ...Object.getOwnPropertySymbols(oldValue)]) { // iterate own keys of oldValue
                //@ts-ignore
                if (Object.getOwnPropertyDescriptor(newValue, key) === undefined && newValue[key] === undefined) {
                    //@ts-ignore
                    delete oldValue[key];
                }
            }
        }
        return oldValue;
    }

    const result = inner();
    if(result !== newValue) { // old was preserved
        call.possiblyObsoleteObjects.add(newValue as object);
    }
    else {
        call.markUsed(newValue);
    }

    return result;
}

function preserve_array<T>(oldArray: Array<unknown>, newArray: Array<unknown>, call: PreserveCall, diagnosis_path: string): Array<unknown> {
    const oldObjectRegistry = new ObjRegistry(call.options);
    oldArray.forEach((v,i) => oldObjectRegistry.register(v, `${diagnosis_path}[${i}]`));

    const indicesInNewArray = new Set<string>();

    for(let i in newArray) {
        indicesInNewArray.add(i);
        const newValue = newArray[i];
        oldArray[i] = oldObjectRegistry.getPreserved(newValue, call, `${diagnosis_path}[${i}]`);
    }

    for(let i in oldArray) {
        if(!indicesInNewArray.has(i)) {
            delete oldArray[i]; // This properly deletes the key as well, so a for...in iteration works consitent. Still it does not decrease oldArray.length
        }
    }

    // Fix oldArray.length:
    while (oldArray.length > newArray.length) {
        oldArray.pop();
    }

    return oldArray;
}


function preserve_set<T>(oldSet: Set<unknown>, newSet: Set<unknown>, call: PreserveCall, diagnosis_path: string): Set<unknown> {

    // Register old ids/keys:
    const oldValuesRegistry = new ObjRegistry(call.options);
    for(const value of oldSet.values()) {
        oldValuesRegistry.register(value, `${diagnosis_path}`);
    }

    oldSet.clear();
    for(const newValue of newSet.values()) {
        oldSet.add(oldValuesRegistry.getPreserved(newValue, call, diagnosis_path));
    }


    return oldSet;
}

function preserve_map<T>(oldMap: Map<unknown, unknown>, newMap: Map<unknown, unknown>, call: PreserveCall, diagnosis_path: string): Map<unknown, unknown> {

    // Register old ids/keys:
    const oldKeysRegistry = new ObjRegistry(call.options);
    for(const key of oldMap.keys()) {
        oldKeysRegistry.register(key, `${diagnosis_path}`);
    }
    const oldValuesRegistry = new ObjRegistry(call.options);
    for(const value of oldMap.values()) {
        oldValuesRegistry.register(value, `${diagnosis_path}`);
    }

    oldMap.clear();
    for(let newKey of newMap.keys()) {
        let newValue = newMap.get(newKey);
        oldMap.set(oldKeysRegistry.getPreserved(newKey, call, diagnosis_path), oldValuesRegistry.getPreserved(newValue, call, `${diagnosis_path}[${diagnisis_shortenValue(newKey)}]`));
    }

    return oldMap;
}


function isSameObjectType(a: object, b: object) {
    return Object.getPrototypeOf(a) === Object.getPrototypeOf(b) || a.constructor === b.constructor;
}

function diagnosis_jsonPath(key: unknown) {
    if(!Number.isNaN(Number(key))) {
        return `[${key}]`;
    }
    return `.${key}`;
}

class PreserveError extends Error {

}

export function diagnisis_shortenValue(evil_value: any) : string {
    if(evil_value === undefined) {
        return "undefined";
    }

    if(evil_value === null) {
        return "null";
    }

    let objPrefix = "";
    if(typeof evil_value == "object" && evil_value.constructor?.name && evil_value.constructor?.name !== "Object") {
        objPrefix = `class ${evil_value.constructor?.name} `;
    }



    function shorten(value: string) {
        const MAX = 50;
        if (value.length > MAX) {
            return value.substring(0, MAX) + "..."
        }
        return value;
    }

    try {
        return shorten(objPrefix + betterJsonStringify(evil_value));
    }
    catch (e) {
    }

    if(typeof evil_value == "string") {
        return shorten(evil_value)
    }
    else if(typeof evil_value == "object") {
        return `${objPrefix}{...}`;
    }
    else {
        return "unknown"
    }

    /**
     * Like JSON.stringify, but support for some additional types.
     *
     * @param value
     */
    function betterJsonStringify(value: unknown) {
        return JSON.stringify(value,(key, val) => {
            if(val === undefined){
                return "undefined"
            }
            else if(typeof val === 'number' && isNaN(val)){
                return "NaN";
            }
            else if(val !== null && JSON.stringify(val) === "null") {
                return "-unknown type-";
            }
            else if(val instanceof Set) {
                return "-Set(...)-";
            }
            else if(val instanceof Map) {
                return "-Map(...)-";
            }
            else if(val instanceof RegExp) {
                return "-Regexp(...)-";
            }
            return val;
        });
    }

}

function mergeable(oldValue: unknown, newValue: unknown) {
    // Return if both are not compatible objects:
    if(oldValue === undefined || oldValue === null || typeof oldValue !== "object") { // oldValue is no object ?
        return false;
    }
    if(newValue === undefined || newValue === null || typeof newValue !== "object") { // new is no object ?
        return false;
    }
    if(!isSameObjectType(oldValue, newValue)) {
        return false;
    }

    if(oldValue === newValue) {
        return false; // nothing to do
    }

    if(newValue instanceof WeakSet) {
        return false; // Merging unsupported
    }
    else if(newValue instanceof WeakMap) {
        return false; // Merging unsupported
    }


    return true;
}

/**
 *
 * Scans root deeply for Arrays and for each found array, it call normalizeList, which squeezes the items with the same id/key into one object instance.
 * @see normalizeList
 * @param root
 * @param options
 */
export function normalizeLists<T extends object>(root: T, options: PreserveOptions = {}) {
    return  visitReplace(root, (value, visitChilds, context) => {
        if(Array.isArray(value)) {
            normalizeList(value, options, context.diagnosis_path);
        }
        return visitChilds(value, context);
    }, "onError");
}

/**
 * Squeezes the items with the same id/key into one object instance.
 * @param list
 * @param options
 * @param diagnosis_path internal
 */
export function normalizeList<T extends unknown[]>(list: T, options: PreserveOptions = {}, diagnosis_path?: string): T {
    const objRegistry = new ObjRegistry(options);
    for(let i in list) {
        const value = list[i];
        if(value === null || typeof value !== "object") { // value is no object ?
            continue;
        }
        let existing = objRegistry.get(value, diagnosis_path || "<list>");
        if(existing !== undefined) {
            // Safety check:
            if(!options.normalize_ignoreDifferent && !_.isEqual(existing, value)) {
                throw new Error(`Array-items at indexes ${list.findIndex(v => v === existing)} and ${i} have the same id/key but different content: ${diagnisis_shortenValue(existing)} vs. ${diagnisis_shortenValue(value)}  Path: ${diagnosis_path}. You can set the normalize_ignoreDifferent option to ignore this.`)
            }
            //@ts-ignore
            list[i] = existing;
            continue;
        }
        objRegistry.register(value, diagnosis_path || "<list>");
    }
    return list;
}