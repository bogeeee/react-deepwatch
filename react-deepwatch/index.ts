import {RecordedRead, WatchedGraph} from "./watchedGraph";
import {throwError} from "./Util";
import {useState} from "react";
import {ProxiedGraph} from "./proxiedGraph";

let currentRun: {
    watchedGraph: WatchedGraph,
    reRender: () => void
} | undefined

export function WatchedComponent<PROPS extends object>(componentFn:(props: PROPS) => any) {
    return (props: PROPS) => {
        const [renderCounter, setRenderCounter] = useState(0);

        currentRun === undefined || throwError("Illegal state: already in currentRun");

        const cleanListenerFns: (()=>void)[] = [];

        function reRender() {
            cleanListenerFns.forEach(c => c()); // Clean the listeners
            setRenderCounter(renderCounter+1);
        }

        const watchedGraph = new WatchedGraph();
        currentRun = {
            watchedGraph,
            reRender
        }

        try {
            const watchedProps = createProxyForProps(watchedGraph, props);

            // Install read listener:
            let readListener = (read: RecordedRead)  => {
                // Re-render on a change of the read value:
                const changeListener = (newValue: unknown) => {
                    if(currentRun) {
                        throw new Error("You must not modify a watched object during the render run.");
                    }
                    reRender()
                }
                read.onChange(changeListener);
                cleanListenerFns.push(() => read.offChange(changeListener)); // Cleanup on re-render
            };
            watchedGraph.onAfterRead(readListener)

            try {
                return componentFn(watchedProps); // Run the user's component function
            }
            finally {
                watchedGraph.offAfterRead(readListener);
            }
        }
        finally {
            currentRun = undefined;
        }
    }
}

function useWatched<T extends object>(obj: T): T {
    currentRun || throwError("useWatched is not used from inside a WatchedComponent");
    return currentRun!.watchedGraph.getProxyFor(obj);
}

export function useWatchedState(initial: object) {
    currentRun || throwError("useWatchedState is not used from inside a WatchedComponent");

    const [state]  = useState(initial);
    return useWatched(state);
}

/**
 * Records the values, that are **immediately** accessed in the loader function. Treats them as dependencies and re-executes the loader when any of these change.
 * <p>
 * Opposed to {@link load}, it does not treat all previously accessed properties as dependencies
 * </p>
 * <p>
 * Immediately means: Before the promise is returned. I.e. does not record any more after your fetch finished.
 * </p>
 * @param loader
 */
function useLoad<T>(loader: () => Promise<T>): T {
    return undefined as T;
}


function load<T>(loader: () => Promise<T>): T {
    // TODO: Also add the result to the watched props, and record, if something actually reads it later. Only then a reload is needed.
    //  TODO: Test that ignoring the result won't trigger a reload then. It is like an effect.
    return undefined as T;
}

/**
 * graph.createProxyFor(props) errors when props's readonly properties are accessed.
 * So instead, this functions does not proxy the **whole** props but each prop individually
 * @param graph
 * @param props
 */
function createProxyForProps<P extends object>(graph: WatchedGraph, props: P): P {
    const result = {}
    Object.keys(props).forEach(key => {
        //@ts-ignore
        const value = props[key];
        Object.defineProperty(result, key,  {
            value: (value!= null && typeof value === "object")?graph.getProxyFor(value):value,
            writable: false
        })
    })
    return result as P;
}