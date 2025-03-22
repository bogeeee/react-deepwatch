import React from "react";
import {createRoot} from "react-dom/client";
import {watchedComponent, watched, useWatchedState} from "react-deepwatch"


const MyComponent = watchedComponent(props => {
    const state = useWatchedState( {myDeep: {counter: 0, b: 2}}, {/* WatchedOptions (optional) */} );

    return <div>
        Counter is: {state.myDeep.counter}<br/>
        <button onClick={ () => state.myDeep.counter++ /* will trigger a rerender */ }>Increase counter</button>
    </div>
}, {/* WatchedComponentOptions (optional) */});

<MyComponent/> // Use MyComponent

createRoot(document.getElementById('root')!).render(<MyComponent/>);