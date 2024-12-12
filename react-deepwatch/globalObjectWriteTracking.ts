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

        // Create proxy:
        //const targetForProxy = {}; // The virtual way
        const targetForProxy=target // Preserves Object.keys and instanceof behaviour :), iterators and other stuff. But the downside with this is, that it does not allow to proxy read only properties
        this.proxy = new Proxy(targetForProxy, this);
    }

    get(fake_target:object, key: ObjKey, value:any, receiver:any): any {
        const ownPropertyDescriptor = Object.getOwnPropertyDescriptor(this.target, key);
        if(ownPropertyDescriptor !== undefined) {
            let getter = ownPropertyDescriptor.get;
            if(getter !== undefined) {
               return getter.apply(this.target);
            }
            else if(ownPropertyDescriptor.value) {
                return ownPropertyDescriptor.value;
            }
            else { // only a setter but nothing else ?
                return undefined;
            }
        }
        //@ts-ignore
        return this.origPrototype[key];
    }

    set(fake_target:object, key: ObjKey, value:any, receiver:any) {
        let writeListenersForTarget = getWriteListenersForObject(this.target);
        const setter = getPropertyDescriptor(this.target, key)?.set;
        if(setter !== undefined) {
            setter.apply(this.target,[value]); // call the setter
            writeListenersForTarget.afterSetterInvoke_listeners.get(key)?.forEach(l => l(value));
            return true;
        }

        //@ts-ignore
        if (this.target[key] !== value) { // modify ?
            //@ts-ignore
            this.target[key] = value
            writeListenersForTarget.afterSetterInvoke_listeners.get(key)?.forEach(l => l(value));
        }
        return true
    }

    getPrototypeOf(target: object): object | null {
        return this.origPrototype;
    }


}
