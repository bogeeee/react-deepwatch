import {AfterWriteListener, DualUseTracker} from "./common";
import {throwError} from "./Util";
import {writeListenersForObject} from "./globalObjectWriteTracking";


/**
 * Listeners for one array.
 * Note for specificity: There will be only one of the **change** events fired. The Recorded...Read.onChange handler will add the listeners to all possible candidates. It's this way around.
 * {@link ObjectWriteListeners} are also subscribed on Arrays
 */
class ArrayWriteListeners {
    afterUnspecificWrite = new Set<AfterWriteListener>
}

export const writeListenersForArray = new WeakMap<unknown[], ArrayWriteListeners>();
export function getWriteListenersForArray(array: unknown[]) {
    let result = writeListenersForArray.get(array);
    if(result === undefined) {
        writeListenersForArray.set(array, result = new ArrayWriteListeners());
    }
    return result;
}

/**
 * Can be either used as a supervisor-class in a WatchedGraphHandler, or installed on the non-proxied object via Object.setPrototypeOf
 * The "this" may be different in these cases.
 */
export class WriteTrackedArray<T> extends Array<T> implements DualUseTracker<Array<T>>{


    // TODO: In the future, implement more fine granular change listeners that act on change of a certain index.


    protected _fireAfterUnspecificWrite() {
        writeListenersForArray.get(this._target)?.afterUnspecificWrite.forEach(l => l(this._target));
    }

    push(...items: any[]): number {

        const result = super.push(...items as any);
        this._fireAfterUnspecificWrite();
        return result;
    }

    pop(...args: any[]) {
        //@ts-ignore
        const result = super.pop(...args);
        this._fireAfterUnspecificWrite();
        return result;
    }

    /**
     * Will return the original object when this class is used as supervisor class in the WatchedGraphHandler
     */
    get _target(): Array<T> {
        return this;
    }

    /**
     * Pretend that this is an array
     */
    get ["constructor"]() {
        return Array;
    }

    shift(...args: any[]): T | undefined {
        //@ts-ignore
        const result = super.shift(...args);
        this._fireAfterUnspecificWrite();
        return result;
    }

    //@ts-ignore
    sort(...args: any[]): Array<T> {
        //@ts-ignore
        const result = super.sort(...args);
        this._fireAfterUnspecificWrite();
        return result;
    }

    reverse(...args: any[]): T[] {
        //@ts-ignore
        const result = super.reverse(...args);
        this._fireAfterUnspecificWrite();
        return result;
    }

    //@ts-ignore
    copyWithin(...args: any[]): Array<T> {
        //@ts-ignore
        const result = super.copyWithin(...args);
        this._fireAfterUnspecificWrite();
        return result;
    }

    //@ts-ignore
    fill(...args: any[]): Array<T> {
        //@ts-ignore
        const result = super.fill(...args);
        this._fireAfterUnspecificWrite();
        return result;
    }

    splice(...args: any[]): T[] {
        //@ts-ignore
        const result = super.splice(...args);
        this._fireAfterUnspecificWrite();
        return result;
    }

    //@ts-ignore
    unshift(...items): number {
        const result = super.unshift(...items);
        this._fireAfterUnspecificWrite();
        return result;
    }
}

export class ArrayProxyHandler implements ProxyHandler<object> {
    target: unknown[];
    proxy: object;

    /**
     * Values are stored/evacuated to here. So a value access hits the get method
     */
    values: unknown[];

    constructor(target: unknown[]) {
        this.target = target;

        Object.getPrototypeOf(target) === Array.prototype || throwError("Can't enhance a subclass of Array. Is the array enhanced or proxied somehow else?"); // Safety check

        // Evacuate values:
        this.values = [...target];
        for(const key in target) {
            delete target[key];
        }

        // Create proxy:
        //const targetForProxy = {}; // The virtual way
        const targetForProxy=target // Preserves Object.keys and instanceof behaviour :), iterators and other stuff. But the downside with this is, that it does not allow to proxy read only properties
        this.proxy = new Proxy(targetForProxy, this);
    }

    get(fake_target:object, key: string | symbol, receiver:any): any {
        // Validity check
        if(receiver !== this.target) {
            throw new Error("Invalid state. Get was called on a different object than this write-tracker-proxy (which is set as the prototype) is for. Did you clone the object, resulting in shared prototypes?")
        }

        let propOnSupervisor = Object.getOwnPropertyDescriptor(WriteTrackedArray.prototype, key);
        if(propOnSupervisor !== undefined) { // Supervisor class is responsible for the property (or method) ?
            //@ts-ignore
            if(propOnSupervisor.get) { // Prop is a getter?
                return propOnSupervisor.get.apply(this.target)
            }
            else if(propOnSupervisor.value) { // Prop is a value, meaning a function. (Supervisors don't have fields)
                return WriteTrackedArray.prototype[key];
            }
        }

        return this.values[key];
    }

    set(fake_target:object, key:  string | symbol, value:any, receiver:any) {
        // Validity check
        if(receiver !== this.target) {
            throw new Error("Invalid state. Set was called on a different object than this write-tracker-proxy (which is set as the prototype) is for. Did you clone the object, resulting in shared prototypes?")
        }

        const isNewKey = !this.values.hasOwnProperty(key);
        if(!isNewKey && this.values[key] === value) { // No change?
            return true;
        }

        this.values[key] = value;

        // Inform the listeners:
        /*
        TODO: call these more fine granular listeners instead
        const writeListeners = writeListenersForObject.get(this.target);
        writeListeners?.afterChangeProperty_listeners.get(key)?.forEach(l => l()); // call listeners;
        if(isNewKey) {
            writeListeners?.afterChangeOwnKeys_listeners.forEach(l => l());
        }
        */
        writeListenersForArray.get(this.target)?.afterUnspecificWrite.forEach(l => l());

        return true;
    }

    getPrototypeOf(target: object): object | null {
        return Array.prototype;
    }

    defineProperty(target: object, property: string | symbol, attributes: PropertyDescriptor): boolean {
        throw new Error("Defineproperty not yet supported");
    }

}