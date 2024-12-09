import {
    AfterWriteListener, debug_numberOfPropertyChangeListeners,
    ForWatchedGraphHandler,
    RecordedPropertyRead, WatchedGraph,
    WatchedGraphHandler
} from "./watchedGraph";
import {Supervisor, writer} from "./writeWatch";
import {WeakMapSet} from "./Util";

export class RecordedArrayLengthRead extends RecordedPropertyRead {
    // TODO: Implemet class properly

    onChange(listener: (newValue: unknown) => void) {
        WatchedArray.afterChangeListeners.add(this.obj as WatchedArray<any>, listener);
    }

    offChange(listener: (newValue: unknown) => void) {
        WatchedArray.afterChangeListeners.delete(this.obj as WatchedArray<any>, listener);
    }
}

export class RecordedArrayValuesRead extends RecordedPropertyRead {
    // TODO: Implemet class properly

    onChange(listener: (newValue: unknown) => void) {
        WatchedArray.afterChangeListeners.add(this.obj as WatchedArray<any>, listener);
    }

    offChange(listener: (newValue: unknown) => void) {
        WatchedArray.afterChangeListeners.delete(this.obj as WatchedArray<any>, listener);
    }
}

export class WatchedArray<T> extends Array<T> implements ForWatchedGraphHandler{
    static afterChangeListeners = new WeakMapSet<WatchedArray<any>, AfterWriteListener>();

    // TODO: In the future, implement more fine granular change listeners that act on change of a certain index.


    _getWatchedGraphHandler(): WatchedGraphHandler | undefined {
        return undefined; // Will return the handler when called through the handler
    }

    get _origThis() {
        return this._getWatchedGraphHandler()?.target as WatchedArray<T> || this;
    }

    protected _fireAfterValuesRead() {
        this._getWatchedGraphHandler()?.fireAfterRead(new RecordedArrayValuesRead("values", {...this._origThis}));
    }

    protected _fireAfterChange() {
        WatchedArray.afterChangeListeners.get(this._origThis)?.forEach(l => l(this._origThis));
    }

    forEach(...args: any[]) {
        const result = super.forEach.apply(this, args as any); // this.values.forEach(...args). Call it on values because the
        return result;
    }

    push(...items: any[]): number {
        let result = super.push(...items as any);
        this._fireAfterChange();
        return result;
    }

    values(): ArrayIterator<T> {
        let result = super.values.apply(this);
        this._fireAfterValuesRead();
        return result;
    }

    get length(): number {
        let result = super.length;
        this._getWatchedGraphHandler()?.fireAfterRead(new RecordedArrayLengthRead("length", result));
        return result;
    }
}