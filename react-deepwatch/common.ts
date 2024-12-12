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

export function getGetter(target: object, propName: ObjKey): (() => unknown) | undefined {
    let propertyDescriptor = Object.getOwnPropertyDescriptor(target, propName);
    if(propertyDescriptor?.get) {
        return propertyDescriptor.get;
    }
    let proto = Object.getPrototypeOf(target);
    if(proto != undefined) {
        return getGetter(proto, propName);
    }

}

export function getSetter(target: object, propName: ObjKey): ((value: any) => void) | undefined {
    let propertyDescriptor = Object.getOwnPropertyDescriptor(target, propName);
    if(propertyDescriptor?.set) {
        return propertyDescriptor.set;
    }
    let proto = Object.getPrototypeOf(target);
    if(proto != undefined) {
        return getSetter(proto, propName);
    }
}