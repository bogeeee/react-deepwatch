import {RecordedRead} from "./watchedGraph";

export type ObjKey = string | symbol;
export type AfterReadListener = (read: RecordedRead) => void;
export type AfterWriteListener = (value: unknown) => void; // TODO: it is strange, that here's only one param: value
export type Clazz = {
    new(...args: unknown[]): unknown
}

/**
 * For use in proxy and direct
 */
export interface DualUseTracker<T> {
    /**
     * The original (unproxied) object
     */
    get _target(): T
}