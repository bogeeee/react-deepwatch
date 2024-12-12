/**
 *
 */
import {getGetter, getSetter, ObjKey} from "./common";

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

    deleteProperty(target: object, p: string | symbol): boolean {
        throw new Error("Must not use delete on a proxied object. Handling of change tracking etc. for this may be not implemented");
    }

    defineProperty(target: object, property: string | symbol, attributes: PropertyDescriptor): boolean {
        throw new Error("Must not use defineProperty on a proxied object. Handling of change tracking etc. for this may not be implemented");
    }

    get (fake_target:object, p:string | symbol, dontUse_receiver:any) {
        const getter = getGetter(this.target, p);
        let value;
        if(this.graph.propertyAccessorsAsWhiteBox && getter !== undefined) { // Access via property accessor ?
            return value = getter.apply(this.proxy,[]); // Call the accessor with a proxied this
        }
        else {
            //@ts-ignore
            value = this.rawRead(p);
        }

        if(value != null && typeof value === "object") {
            const descriptor = Object.getOwnPropertyDescriptor(this.target, p);

            // Handle read-only property:
            if(descriptor !== undefined && !descriptor.writable) {
                // The js runtime would prevent us from returning a proxy :( Pretty mean :(
                throw new Error("Cannot proxy a read-only property. This is not implemented."); // TODO: Implement the virtual way (see constructor)
                //Try to crack up the target:
                //Object.defineProperty(this.target, p, {...descriptor, writable: true}); // Redefine property: Does not work
            }

            return this.graph.getProxyFor(value);
        }

        return value;
    }

    rawRead(key: ObjKey): unknown {
        //@ts-ignore
        return this.target[key as any];
    }

    set(fake_target:object, p:string | symbol, value:any, receiver:any) {
        const setter = getSetter(this.target, p);
        if(this.graph.propertyAccessorsAsWhiteBox && setter !== undefined) { // Setting via property access ?
            setter.apply(this.proxy,[value]); // Only call the accessor with a proxied this
        }
        else {
            //@ts-ignore
            if (this.target[p] !== value) { // modify ?
                this.rawWrite(p, value);
            }
        }
        return true
    }

    protected rawWrite(p: string | symbol, newValue: any) {
        //@ts-ignore
        this.target[p] = newValue
    }



}


const proxyToProxyHandler = new WeakMap<object, GraphProxyHandler<any>>();
function getProxyHandler(proxy: object) {
    return proxyToProxyHandler.get(proxy);
}

