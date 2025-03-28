import React from "react";
import {createRoot} from "react-dom/client";
import {watchedComponent, useWatchedState, watched, load, poll, isLoading, loadFailed, preserve, bind, READS_INSIDE_LOADER_FN} from "react-deepwatch"


const MyComponent = watchedComponent(props => {
    const state = useWatchedState( {myDeep: {counter: 0, b: 2}}, {/* WatchedOptions (optional) */} );

    return <div>
        Counter is: {state.myDeep.counter}<br/>
        <button onClick={ () => state.myDeep.counter++ /* will trigger a rerender */ }>Increase counter</button>
    </div>
}, {/* WatchedComponentOptions (optional) */});

createRoot(document.getElementById('root')).render(<MyComponent/>);