/**
 *
 */
export abstract class ProxiedGraph<HANDLER extends GraphProxyHandler<any>> {
    // *** Configuration: ***
    protected abstract graphProxyHandlerConstructor: {  new(target: object, graph: any): HANDLER  }
    /**
     * Treats them like functions, meaning, they get a proxied 'this'. WatchProxies will see the access to the real properties
     */
    public propertyAccessorsAsWhiteBox = true;

    // *** State: ***
    protected proxies = new WeakSet<object>();
    protected objectsToProxyHandlers = new WeakMap<object, HANDLER>();


    getProxyFor<O extends object>(obj: O): O {
        if(this.proxies.has(obj)) { // Already the our proxied object ?
            return obj;
        }

        let handlerForObj = this.objectsToProxyHandlers.get(obj);
        if(handlerForObj !== undefined) { // obj was an unproxied object and we have the proxy for it ?
            return handlerForObj.proxy as O;
        }

        handlerForObj = new this.graphProxyHandlerConstructor(obj, this);
        // register:
        this.proxies.add(handlerForObj.proxy);
        this.objectsToProxyHandlers.set(obj, handlerForObj);

        return handlerForObj.proxy as O;
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
        //const targetForProxy = {}; // Don't do. Only giving it the real target preserves Object.key and instanceof behaviour
        const targetForProxy=target
        this.proxy = new Proxy(targetForProxy, this);
    }

    deleteProperty(target: object, p: string | symbol): boolean {
        throw new Error("Must not use delete on a proxied object. Handling of change tracking etc. for this may be not implemented");
    }

    defineProperty(target: object, property: string | symbol, attributes: PropertyDescriptor): boolean {
        throw new Error("Must not use defineProperty on a proxied object. Handling of change tracking etc. for this may not be implemented");
    }

    get (fake_target:object, p:string | symbol, dontUse_receiver:any) {
        const getter = this.getGetter(this.target, p);
        let value;
        if(this.graph.propertyAccessorsAsWhiteBox && getter !== undefined) { // Access via property accessort ?
            value = getter.apply(this.proxy,[]); // Call the accessor with a proxied this
        }
        else {
            //@ts-ignore
            value = this.target[p];
        }

        if(value != null && typeof value === "object") {
            return this.graph.getProxyFor(value);
        }

        return value;
    }

    set(fake_target:object, p:string | symbol, value:any, receiver:any) {
        const setter = this.getSetter(this.target, p);
        if(this.graph.propertyAccessorsAsWhiteBox && setter !== undefined) { // Setting via property access ?
            setter.apply(this.proxy,[value]); // Only call the accessor with a proxied this
        }
        else {
            //@ts-ignore
            if (this.target[p] !== value) { // modify ?
                this.handleModifyTarget(p, value);
            }
        }
        return true
    }

    protected handleModifyTarget(p: string | symbol, value: any) {
        //@ts-ignore
        this.target[p] = value
    }

    protected getGetter(target: object, propName: string | symbol): (() => any) | undefined {
        let propertyDescriptor = Object.getOwnPropertyDescriptor(target, propName);
        if(propertyDescriptor?.get) {
            return propertyDescriptor.get;
        }
        let proto = Object.getPrototypeOf(target);
        if(proto != undefined) {
            return this.getGetter(proto, propName);
        }

    }

    protected getSetter(target: object, propName: string | symbol): ((value: any) => void) | undefined {
        let propertyDescriptor = Object.getOwnPropertyDescriptor(target, propName);
        if(propertyDescriptor?.set) {
            return propertyDescriptor.set;
        }
        let proto = Object.getPrototypeOf(target);
        if(proto != undefined) {
            return this.getSetter(proto, propName);
        }
    }

}


const proxyToProxyHandler = new WeakMap<object, GraphProxyHandler<any>>();
function getProxyHandler(proxy: object) {
    return proxyToProxyHandler.get(proxy);
}

