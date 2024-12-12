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

/**
 * Like Object.getOwnPropertyDescriptor. But for all parent classes
 * @param o
 * @param p
 */
export function getPropertyDescriptor(o: object, p: PropertyKey):  PropertyDescriptor | undefined {
    let result = Object.getOwnPropertyDescriptor(o, p);
    if(result !== undefined) {
        return result;
    }
    let proto = Object.getPrototypeOf(o);
    if(proto !== null) {
        return getPropertyDescriptor(proto, p);
    }
}