/**
 * Listeners for one object
 */
import {MapSet} from "./Util";
import {AfterWriteListener, getPropertyDescriptor, ObjKey} from "./common";

class ObjectWriteListeners {
    /**
     * For writes (also if these are the same/unchanged values) on setters
     */
    afterSetterInvoke_listeners = new MapSet<ObjKey, AfterWriteListener>();
    afterChangeProperty_listeners = new MapSet<ObjKey, AfterWriteListener>();
}

export const writeListenersForObect = new WeakMap<object, ObjectWriteListeners>();
export function getWriteListenersForObject(obj: object) {
    let result = writeListenersForObect.get(obj);
    if(result === undefined) {
        writeListenersForObect.set(obj, result = new ObjectWriteListeners());
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
        let currentValue = origDescriptor?.value /* performance */ || target[key];
        const origSetter = origDescriptor?.set;
        const origGetter = origDescriptor?.get;
        Object.defineProperty( target, key, {
            set(newValue: any) {
                const writeListenersForTarget = getWriteListenersForObject(target);

                if(origSetter !== undefined) {
                    origSetter.apply(target, [newValue]);  // call the setter
                    writeListenersForTarget.afterSetterInvoke_listeners.get(key)?.forEach(l => l(newValue)); // call listeners
                    return;
                }

                //@ts-ignore
                if (newValue !== currentValue) { // modify ?
                    //@ts-ignore
                    currentValue = newValue;
                    writeListenersForTarget.afterChangeProperty_listeners.get(key)?.forEach(l => l(newValue)); // call listeners
                }
            },
            get() {
                if(origGetter !== undefined) {
                    return origGetter.apply(target);  // call the getter
                }
                return currentValue;
            }
        })
    }

    get(fake_target:object, key: ObjKey, receiver:any): any {
        // Instead, do, what js would do internally:
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
        // if this method got called, there is no setter trap installed yet

        this.installSetterTrap(key);
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
