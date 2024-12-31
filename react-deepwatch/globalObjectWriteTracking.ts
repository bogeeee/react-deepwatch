/**
 * Listeners for one object
 */
import {MapSet} from "./Util";
import {AfterWriteListener, getPropertyDescriptor, GetterFlags, ObjKey, SetterFlags} from "./common";

class ObjectWriteListeners {
    /**
     * For writes on **setters** (also if these are the same/unchanged values)
     */
    afterSetterInvoke_listeners = new MapSet<ObjKey, AfterWriteListener>();
    afterChangeProperty_listeners = new MapSet<ObjKey, AfterWriteListener>();
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
    origPrototype: object | null;
    proxy: object;

    constructor(target: object) {
        this.target = target;
        this.origPrototype = Object.getPrototypeOf(target);


        Object.getOwnPropertyNames(target).forEach(p => this.installSetterTrap(p));

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
                throw new Error("Cannot delete non- 'configurable' property.");
            }
            //@ts-ignore
            delete target[key]; // delete the old, or the following Object.defineProperty will conflict
        }

        const newSetter=  (newValue: any) => {
            const writeListenersForTarget = writeListenersForObject.get(target);

            if(origSetter !== undefined) {
                origSetter.apply(target, [newValue]);  // call the setter
                writeListenersForTarget?.afterSetterInvoke_listeners.get(key)?.forEach(l => l(newValue)); // call listeners
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
                writeListenersForTarget?.afterChangeProperty_listeners.get(key)?.forEach(l => l(newValue)); // call listeners
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
            configurable: true, // Allow to delete the property
        })
    }

    get(fake_target:object, key: ObjKey, receiver:any): any {
        // Validity check
        if(receiver !== this.target) {
            throw new Error("Invalid state. Get was called on a different object than this write-tracker-proxy (which is set as the prototype) is for. Did you clone the object, resulting in shared prototypes?")
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
        return true;
    }

    getPrototypeOf(target: object): object | null {
        return this.origPrototype;
    }

    defineProperty(target: object, property: string | symbol, attributes: PropertyDescriptor): boolean {
        throw new Error("Defineproperty not yet supported");
    }

}
