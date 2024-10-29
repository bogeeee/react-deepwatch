export function throwError(e: string | Error) {
    if(e !== null && e instanceof Error) {
        throw e;
    }
    throw new Error(e);
}


/**
 * A Map<K, Set<V>>. But automatically add a new Set if needed
 */
export class MapSet<K, V> {
    map = new Map<K, Set<V>>()

    add(key: K, value: V) {
        let set = this.map.get(key);
        if(set === undefined) {
            set = new Set<V>();
            this.map.set(key, set);
        }
        set.add(value);
    }

    delete(key: K, value: V) {
        let set = this.map.get(key);
        if(set !== undefined) {
            set.delete(value);
            if(set.size === 0) {
                this.map.delete(key); // Clean up
            }
        }
    }

    get(key: K) {
        return this.map.get(key);
    }
}

export function arraysAreEqualsByPredicateFn<A, B>(a: A[], b: B[], equalsFn: (a: A,b: B) => boolean) {
    if(a.length !== b.length) {
        return false;
    }
    for(const k in a) {
        if(!equalsFn(a[k], b[k])) {
            return false;
        }
    }
    return true;
}

