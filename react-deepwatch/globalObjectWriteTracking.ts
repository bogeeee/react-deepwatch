/**
 * Listeners for one object
 */
import {MapSet} from "./Util";
import {
    AfterChangeOwnKeysListener,
    AfterWriteListener,
    getPropertyDescriptor,
    GetterFlags,
    ObjKey,
    runAndCallListenersOnce_after,
    SetterFlags,
    WriteTrackerClass
} from "./common";

/**
 * Note for specificity: There will be only one of the **change** events fired. The Recorded...Read.onChange handler will add the listeners to all possible candidates. It's this way around.
 * Does not apply to setterInvoke.. These are fired in addition (not thought through for all situations)
 */
class ObjectWriteListeners {
    /**
     * For writes on **setters** (also if these are the same/unchanged values)
     */
    afterSetterInvoke_listeners = new MapSet<ObjKey, AfterWriteListener>();
    afterChangeSpecificProperty_listeners = new MapSet<ObjKey, AfterWriteListener>();
    afterChangeAnyProperty_listeners = new Set<AfterWriteListener>();

    /**
     * Means, the result of Object.keys will be different after the change. All iterations over the object/arrays's keys or values are informed that there was a change. Individual {@link afterChangeSpecificProperty_listeners} are not affected!
     */
    afterChangeOwnKeys_listeners = new Set<AfterChangeOwnKeysListener>();
    /**
     * These will always be called, no matter how specific a change is
     * TODO: rename to afterAnyChange?
     */
    afterAnyWrite_listeners = new Set<()=>void>();

    /**
     * TODO: rename to afterUnspecificChange
     */
    afterUnspecificWrite = new Set<AfterWriteListener>();
}

export const writeListenersForObject = new WeakMap<object, ObjectWriteListeners>();
export function getWriteListenersForObject(obj: object) {
    let result = writeListenersForObject.get(obj);
    if(result === undefined) {
        writeListenersForObject.set(obj, result = new ObjectWriteListeners());
    }
    return result;
}

export class ObjectProxyHandler implements ProxyHandler<object> {
    target: object;
    supervisorClass?: WriteTrackerClass
    origPrototype: object | null;

    proxy: object;

    constructor(target: object, supervisorClass?: WriteTrackerClass) {
        this.target = target;
        this.supervisorClass = supervisorClass;
        this.origPrototype = Object.getPrototypeOf(target);


        Object.getOwnPropertyNames(target).forEach(key => {
            if(key === "length" && Array.isArray(target)) {
                return; // Leave the length property as is. It won't be set directly anyway
            }
            this.installSetterTrap(key)
        });

        // Create proxy:
        //const targetForProxy = {}; // The virtual way
        const targetForProxy=target // Preserves Object.keys and instanceof behaviour :), iterators and other stuff. But the downside with this is, that it does not allow to proxy read only properties
        this.proxy = new Proxy(targetForProxy, this);
    }

    installSetterTrap(key: ObjKey) {
        let target = this.target;
        let origDescriptor = getPropertyDescriptor(target, key);
        //@ts-ignore
        let currentValue = origDescriptor?.value /* performance */ || target[key];
        const origSetter = origDescriptor?.set;
        const origGetter = origDescriptor?.get;

        let origOwnDescriptor = Object.getOwnPropertyDescriptor(target, key);
        if(origOwnDescriptor !== undefined) {
            if(origOwnDescriptor.configurable !== true) {
                throw new Error("Cannot delete non- 'configurable' property:" + String(key));
            }
            //@ts-ignore
            delete target[key]; // delete the old, or the following Object.defineProperty will conflict
        }

        const newSetter=  (newValue: any) => {
            runAndCallListenersOnce_after(target, (callListeners) => {
                const writeListenersForTarget = writeListenersForObject.get(target);

                if(origSetter !== undefined) {
                    origSetter.apply(target, [newValue]);  // call the setter
                    callListeners(writeListenersForTarget?.afterSetterInvoke_listeners.get(key));
                    callListeners(writeListenersForTarget?.afterAnyWrite_listeners);
                    return;
                }

                if(origGetter !== undefined) {
                    currentValue = origGetter.apply(target);  // call the getter. Is this a good idea to refresh the value here?
                    throw new TypeError("Target originally had a getter and no setter but the property is set.");
                }

                //@ts-ignore
                if (newValue !== currentValue) { // modify ?
                    //@ts-ignore
                    currentValue = newValue;

                    // Call listeners:
                    if(Array.isArray(target)) {
                        callListeners(writeListenersForObject.get(target)?.afterUnspecificWrite);
                    }
                    callListeners(writeListenersForTarget?.afterChangeSpecificProperty_listeners.get(key))
                    callListeners(writeListenersForTarget?.afterChangeAnyProperty_listeners)
                    callListeners(writeListenersForTarget?.afterAnyWrite_listeners)
                }
            });
        }
        (newSetter as SetterFlags).origHadSetter = origSetter !== undefined;

        const newGetter = () => {
            if(origGetter !== undefined) {
                currentValue = origGetter.apply(target);  // call the getter
            }
            return currentValue;
        }
        (newGetter as GetterFlags).origHadGetter = origGetter !== undefined;

        Object.defineProperty( target, key, { // TODO: [Performance optimization tipps, see js example](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/defineProperty#description)
            set: newSetter,
            get: newGetter,
            enumerable: origOwnDescriptor !== undefined?origOwnDescriptor?.enumerable:true,
            configurable: true, // Allow to delete the property. Note that you should use the {@link deleteProperty} function
        })
    }

    fire_array_afterUnspecificWrite() {
        return runAndCallListenersOnce_after(this.target, (callListeners) => {
            callListeners(writeListenersForObject.get(this.target as Array<unknown>)?.afterUnspecificWrite);
            callListeners(writeListenersForObject.get(this.target as Array<unknown>)?.afterAnyWrite_listeners);
        });
    }

    get(fake_target:object, key: ObjKey, receiver:any): any {
        // Validity check
        const target = this.target;

        if(receiver !== target) {
            throw new Error("Invalid state. Get was called on a different object than this write-tracker-proxy (which is set as the prototype) is for. Did you clone the object, resulting in shared prototypes?")
        }

        // Check for and use supervisor class:
        const supervisorClass = this.supervisorClass
        if (supervisorClass !== undefined) {
            let propOnSupervisor = Object.getOwnPropertyDescriptor(supervisorClass.prototype, key);
            if (propOnSupervisor !== undefined) { // Supervisor class is responsible for the property (or method) ?
                //@ts-ignore
                if (propOnSupervisor.get) { // Prop is a getter?
                    return propOnSupervisor.get.apply(target)
                } else if (propOnSupervisor.value) { // Prop is a value, meaning a function. (Supervisors don't have fields)
                    return supervisorClass.prototype[key];
                }
            }
            else {
                const origValue = supervisorClass.prototype[key]
                if(typeof origValue === "function") {
                    origMethod = origValue;
                    if (supervisorClass.knownHighLevelMethods.has(key)) {
                        return trapForHighLevelWriterMethod
                    } else if (!supervisorClass.readOnlyMethods.has(key) && !(key as any in Object.prototype)) { // Read-write method that was not handled directly by supervisor class?
                        return trapForGenericWriterMethod // Assume the worst, that it is a writer method
                    }
                }
            }
        }

        // return this.target[key]; // This line does not work because it does not consult ObjectProxyHandler#getPrototypeOf and therefore uses the actual tinkered prototype chain which has this proxy in there and calls get (endless recursion)
        const propDesc = getPropertyDescriptor(target, key)
        if (propDesc !== undefined) {
            let result: unknown;
            let getter = propDesc.get;
            if (getter !== undefined) {
                result = getter.apply(target);
            }
            else {
                result = propDesc.value;
            }
            return result;
        }

        var origMethod: ((this:unknown, ...args:unknown[]) => unknown) | undefined = undefined;
       /**
         * Calls the afterUnspecificWrite listeners
         * @param args
         */
        function trapForGenericWriterMethod(this:object, ...args: unknown[]) {
            if(this !== receiver) {
                //throw new Error("Invalid state. Method was called on invalid target")
            }
            return runAndCallListenersOnce_after(target, (callListeners) => {
                const callResult = origMethod!.apply(this, args);  // call original method
                callListeners(writeListenersForObject.get(target as Array<unknown>)?.afterUnspecificWrite); // Call listeners
                callListeners(writeListenersForObject.get(target as Array<unknown>)?.afterAnyWrite_listeners); // Call listeners
                return callResult;
            });
        }

        /**
         * Wraps it in runAndCallListenersOnce_after
         * @param args
         */
        function trapForHighLevelWriterMethod(this:object, ...args: unknown[]) {
            if(this !== receiver) {
                //throw new Error("Invalid state. Method was called on invalid target")
            }
            return runAndCallListenersOnce_after(target, (callListeners) => {
                return origMethod!.apply(this, args);  // call original method
            });
        }
    }

    set(fake_target:object, key: ObjKey, value:any, receiver:any) {
        // Validity check
        if(receiver !== this.target) {
            throw new Error("Invalid state. Set was called on a different object than this write-tracker-proxy (which is set as the prototype) is for. Did you clone the object, resulting in shared prototypes?")
        }

        runAndCallListenersOnce_after(this.target, (callListeners) => {

            // if this "set" method got called, there is no setter trap installed yet
            this.installSetterTrap(key);

            //@ts-ignore
            this.target[key] = value; // Set value again. this should call the setter trap

            // There was no setter trap yet. This means that the key is new. Inform those listeners:
            callListeners(writeListenersForObject.get(this.target)?.afterChangeOwnKeys_listeners);
            callListeners(writeListenersForObject.get(this.target)?.afterAnyWrite_listeners);
        });

        return true;
    }

    getPrototypeOf(target: object): object | null {
        return this.origPrototype;
    }

    defineProperty(target: object, property: string | symbol, attributes: PropertyDescriptor): boolean {
        throw new Error("Defineproperty not yet supported");
    }

}
