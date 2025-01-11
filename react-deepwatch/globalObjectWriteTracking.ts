/**
 * Listeners for one object
 */
import {MapSet} from "./Util";
import {
    AfterChangeOwnKeysListener,
    AfterWriteListener, Clazz,
    getPropertyDescriptor,
    GetterFlags,
    ObjKey,
    SetterFlags
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
    afterChangeProperty_listeners = new MapSet<ObjKey, AfterWriteListener>();
    afterChangeOwnKeys_listeners = new Set<AfterChangeOwnKeysListener>();
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
    supervisorClass?: Clazz
    origPrototype: object | null;

    proxy: object;

    constructor(target: object, supervisorClass?: Clazz) {
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
            const writeListenersForTarget = writeListenersForObject.get(target);

            if(origSetter !== undefined) {
                origSetter.apply(target, [newValue]);  // call the setter
                writeListenersForTarget?.afterSetterInvoke_listeners.get(key)?.forEach(l => l()); // call listeners
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
                writeListenersForTarget?.afterChangeProperty_listeners.get(key)?.forEach(l => l()); // call listeners
            }
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

    get(fake_target:object, key: ObjKey, receiver:any): any {
        // Validity check
        if(receiver !== this.target) {
            throw new Error("Invalid state. Get was called on a different object than this write-tracker-proxy (which is set as the prototype) is for. Did you clone the object, resulting in shared prototypes?")
        }

        // Check for and use supervisor class:
        const supervisorClass = this.supervisorClass
        if (supervisorClass !== undefined) {
            let propOnSupervisor = Object.getOwnPropertyDescriptor(supervisorClass.prototype, key);
            if (propOnSupervisor !== undefined) { // Supervisor class is responsible for the property (or method) ?
                //@ts-ignore
                if (propOnSupervisor.get) { // Prop is a getter?
                    return propOnSupervisor.get.apply(this.target)
                } else if (propOnSupervisor.value) { // Prop is a value, meaning a function. (Supervisors don't have fields)
                    return supervisorClass.prototype[key];
                }
            }
        }


        // return this.target[key]; // This line does not work because it does not consult ObjectProxyHandler#getPrototypeOf and therefore uses the actual tinkered prototype chain which has this proxy in there and calls get (endless recursion)
        const propDesc = getPropertyDescriptor(this.target, key)
        if (propDesc !== undefined) {
            let getter = propDesc.get;
            if (getter !== undefined) {
                return getter.apply(this.target);
            }
            return  propDesc.value;
        }
    }

    set(fake_target:object, key: ObjKey, value:any, receiver:any) {
        // Validity check
        if(receiver !== this.target) {
            throw new Error("Invalid state. Set was called on a different object than this write-tracker-proxy (which is set as the prototype) is for. Did you clone the object, resulting in shared prototypes?")
        }

        // if this method got called, there is no setter trap installed yet

        this.installSetterTrap(key);
        //@ts-ignore
        this.target[key] = value; // Set value again. this should call the setter trap

        // There was no setter trap yet. This means that the key is new. Inform those listeners:
        const writeListenersForTarget = writeListenersForObject.get(this.target);
        if(writeListenersForTarget !== undefined) {
            const ownKeys = Reflect.ownKeys(this.target);
            writeListenersForTarget.afterChangeOwnKeys_listeners.forEach(l => l());
        }

        return true;
    }

    getPrototypeOf(target: object): object | null {
        return this.origPrototype;
    }

    defineProperty(target: object, property: string | symbol, attributes: PropertyDescriptor): boolean {
        throw new Error("Defineproperty not yet supported");
    }

}
