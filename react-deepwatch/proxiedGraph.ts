/**
 *
 */
import {getPropertyDescriptor, GetterFlags, ObjKey, SetterFlags} from "./common";
import {deleteProperty} from "./globalWriteTracking";

export abstract class ProxiedGraph<HANDLER extends GraphProxyHandler<any>> {
    // *** Configuration: ***
    /**
     * Treats them like functions, meaning, they get a proxied 'this'. WatchProxies will see the access to the real properties
     */
    public propertyAccessorsAsWhiteBox = true;

    // *** State: ***
    protected proxies = new WeakSet<object>();
    protected objectsToProxyHandlers = new WeakMap<object, HANDLER>();

    protected abstract crateHandler(target: object, graph: any): HANDLER;

    getProxyFor<O>(value: O): O {
        if(value === null || typeof value !== "object") { // not an object?
            return value;
        }

        if(value instanceof Iterator) {
            return value; // TODO: Implement Iterator supervisors and remove this line
        }

        if(this.proxies.has(value)) { // Already our proxied object ?
            return value;
        }

        let handlerForObj = this.objectsToProxyHandlers.get(value);
        if(handlerForObj !== undefined) { // value was an unproxied object and we have the proxy for it ?
            return handlerForObj.proxy as O;
        }

        handlerForObj = this.crateHandler(value, this);
        // register:
        proxyToProxyHandler.set(handlerForObj.proxy, handlerForObj);
        this.proxies.add(handlerForObj.proxy);
        this.objectsToProxyHandlers.set(value, handlerForObj);


        return handlerForObj.proxy as O;
    }

    /**
     *
     * @param value
     * @return the original non-proxied value
     */
    getUnproxiedValue<O>(value: O): O {
        if(value === null || typeof value !== "object") { // not an object?
            return value;
        }

        return proxyToProxyHandler.get(value)?.target as O|| value;
    }

    getHandlerFor(obj: object) {
        return getProxyHandler(this.getProxyFor(obj)) as HANDLER;
    }

}

export abstract class GraphProxyHandler<GRAPH extends ProxiedGraph<any>> implements ProxyHandler<object> {
    target: object;
    proxy: object;
    graph: GRAPH;

    constructor(target: object, graph: GRAPH) {
        this.target = target;
        this.graph = graph;

        // Create proxy:
        //const targetForProxy = {}; // The virtual way
        const targetForProxy=target // Preserves Object.keys and instanceof behaviour :), iterators and other stuff. But the downside with this is, that it does not allow to proxy read only properties
        this.proxy = new Proxy(targetForProxy, this);
    }

    deleteProperty(target: object, key: string | symbol): boolean {
        //@ts-ignore
        return deleteProperty(this.target,key);
    }

    defineProperty(target: object, property: string | symbol, attributes: PropertyDescriptor): boolean {
        throw new Error("Must not use defineProperty on a proxied object. Handling of change tracking etc. for this may not be implemented");
    }

    get (fake_target:object, p:string | symbol, receiver:any) {
        // Validity check
        if(receiver !== this.proxy) {
            throw new Error("Invalid state. Get was called on a different object than this proxy  is for."); // Cannot imagine a legal case
        }

        const getter = getPropertyDescriptor(this.target, p)?.get;
        let value;
        if(this.graph.propertyAccessorsAsWhiteBox && getter !== undefined && (getter as GetterFlags).origHadGetter !== false) { // Access via real property accessor ?
            return value = getter.apply(this.proxy,[]); // Call the accessor with a proxied this
        }
        else {
            //@ts-ignore
            value = this.rawRead(p);
        }

        if(value != null && typeof value === "object") {
            const descriptor = Object.getOwnPropertyDescriptor(this.target, p);

            // Handle read-only property:
            if(descriptor !== undefined && descriptor.writable === false) {
                // The js runtime would prevent us from returning a proxy :( Pretty mean :(
                throw new Error("Cannot proxy a read-only property. This is not implemented."); // TODO: Implement the virtual way (see constructor)
            }

            return this.graph.getProxyFor(value);
        }

        return value;
    }

    protected rawRead(key: ObjKey): unknown {
        //@ts-ignore
        return this.target[key as any];
    }

    set(fake_target:object, p:string | symbol, value:any, receiver:any) {
        // Validity check
        if(receiver !== this.proxy) {
            throw new Error("Invalid state. Set was called on a different object than this proxy  is for."); // Cannot imagine a legal case
        }

        const setter = getPropertyDescriptor(this.target, p)?.set;
        if(this.graph.propertyAccessorsAsWhiteBox && setter !== undefined && (setter as SetterFlags).origHadSetter !== false) { // Setting via real property accessor ?
            setter.apply(this.proxy,[value]); // Only call the accessor with a proxied this
        }
        else {
            const unproxiedValue = this.graph.getUnproxiedValue(value);
            //@ts-ignore
            if (this.target[p] !== unproxiedValue) { // modify ?
                this.rawChange(p, unproxiedValue);
            }
        }
        return true
    }

    protected rawChange(p: string | symbol, newUnproxiedValue: any) {
        //@ts-ignore
        this.target[p] = newUnproxiedValue
    }



}


const proxyToProxyHandler = new WeakMap<object, GraphProxyHandler<any>>();
function getProxyHandler(proxy: object) {
    return proxyToProxyHandler.get(proxy);
}

/**
 * Makes the obj throw an error when trying to access it
 * @param obj
 * @param message
 * @param cause
 */
export function invalidateObject(obj: object, message: string, cause?: Error) {
    const throwInvalid = () => {
        throw new Error(message, {cause: cause});
    }

    // Delete all writeable  own props:
    const descrs = Object.getOwnPropertyDescriptors(obj);
    for(const k in descrs) {
        const desc = descrs[k];
        if(desc.configurable) {
            //@ts-ignore
            delete obj[k];
        }
    }

    Object.setPrototypeOf(obj, new Proxy(obj, {
        get(target: object, p: string | symbol, receiver: any): any {
            throwInvalid();
        },
        set(target: object, p: string | symbol, newValue: any, receiver: any): boolean {
            throwInvalid()
            return false;
        },
        defineProperty(target: object, property: string | symbol, attributes: PropertyDescriptor): boolean {
            throwInvalid();
            return false;
        },
        deleteProperty(target: object, p: string | symbol): boolean {
            throwInvalid()
            return false;
        },
        ownKeys(target: object): ArrayLike<string | symbol> {
            throwInvalid()
            return [];
        }
    }))
}