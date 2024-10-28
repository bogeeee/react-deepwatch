import {GraphProxyHandler, ProxiedGraph} from "./proxiedGraph";

type ObjKey = keyof object;

type AfterReadListener = (obj: object, prop: ObjKey, readValue: unknown) => void;
type AfterWriteListener = (obj: object, prop: ObjKey, writtenValue: unknown) => void;

/**
 * Use cases:
 * - record read + watch recorded for modifications. For re-render trigger
 * - record read and make several snapshots (when load is called) and compare exactly those reads
 */
export class WatchedGraph extends ProxiedGraph<WatchedGraphHandler> {
    // *** Configuration: ***
    protected graphProxyHandlerConstructor = WatchedGraphHandler

    /**
     * Watches also writes that are not made through a proxy of this WatchedGraph by installing a setter (property accessor) on each of the desired properties
     * Works only for **individual** properties which you are explicitly listening on, and not on the whole Graph.
     * See {@link onAfterWrite} for the listener
     *
     */
    public watchWritesFromOutside = true

    // *** State: ****

    /**
     * Called after a read has been made to any object inside this graph
     * @protected
     */
    protected afterReadListeners = new Set<AfterReadListener>()

    /**
     * Called after a write has been made to any object inside this graph
     * Note: There are also listeners for specified properties (which are more capable)
     * TODO: Do we need this ?
     * @protected
     */
    protected afterWriteListeners = new Set<AfterWriteListener>()


    onAfterRead(listener: AfterReadListener) {
        this.afterReadListeners.add(listener);
    }

    offAfterRead(listener: AfterReadListener) {
        this.afterReadListeners.delete(listener);
    }

    /**
     * Watches for writes on a specified property
     * @param obj
     * @param key
     * @param listener
     */
    onAfterWriteOnProperty(obj: object, key: PropertyKey, listener:  AfterWriteListener) {
        throw new Error("TODO");
    }

    offAfterWriteOnProperty(obj: object, key: PropertyKey, listener:  AfterWriteListener) {
        throw new Error("TODO");
    }


}

class WatchedGraphHandler extends GraphProxyHandler<WatchedGraph> {
    constructor(target: object, graph: WatchedGraph) {
        super(target, graph);
    }

    // TODO: implement afterRead and afterWrite listeners
}