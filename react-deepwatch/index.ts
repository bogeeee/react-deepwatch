import {WatchedGraph} from "./watchedGraph";
import {throwError} from "./Util";
import {useState} from "react";

let currentRun: {
    watchedGraph: WatchedGraph,
    rerender: () => void
} | undefined
export function WatchedComponent<PROPS extends object>(componentFn:(props: PROPS) => any) {
    return (props: PROPS) => {
        const [renderCounter, setRenderCounter] = useState(0);

        currentRun === undefined || throwError("Illegal state: already in currentRun");

        const watchedGraph = new WatchedGraph();
        currentRun = {
            watchedGraph,
            rerender() {
                setRenderCounter(renderCounter+1);
            }
        }

        try {
            const watchedProps = watchedGraph.getProxyFor(props);
            return componentFn(watchedProps);
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