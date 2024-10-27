import {GraphProxyHandler, ProxiedGraph} from "./proxiedGraph";

type Change<O extends object> = {parent: O, prop: keyof O}


/**
 * Use cases:
 * - record read + watch recorded for modifications. For re-render trigger
 * - record read and make several snapshots (when load is called) and compare exactly those reads
 */
export class WatchedGraph extends ProxiedGraph<WatchedGraphHandler> {
    // *** Configuration: ***
    protected graphProxyHandlerConstructor = WatchedGraphHandler
    // *** State: ****
    protected readListeners = new Set<((change: Change<any>) => void)>()
    protected writeListeners = new Set<((change: Change<any>) => void)>()


    onWrite(listener: (change: Change<any>) => void) {
        this.readListeners.add(listener);
    }
    offWrite(listener: (change: Change<any>) => void) {
        this.readListeners.delete(listener);
    }

    withRecordWrites(exec: () => void): Change<any>[] {
        this.onWrite((change => {

        }));
        throw new Error("TODO")
    }

    async asyncWithRecordChanges(exec: () => Promise<void>): Promise<Change<any>[]> {
        throw new Error("TODO");
    }
}

class WatchedGraphHandler extends GraphProxyHandler<WatchedGraph> {
    constructor(target: object, graph: WatchedGraph) {
        super(target, graph);
    }
}