import React from "react";
import {createRoot} from "react-dom/client";
import {watchedComponent, useWatchedState, watched, load, poll, isLoading, loadFailed, preserve, bind} from "react-deepwatch"

async function myFetchFromServer() {
    return (await(await fetch("example.json")).json()).name
}

const MyComponent = watchedComponent(props => {

    return <div>
        Here's something fetched from the Server: {  load( async () => await myFetchFromServer(), {/* LoadOptions (optional) */} )  }
    </div>
}, {/* WatchedComponentOptions (optional) */});

<MyComponent/> // Use MyComponent

createRoot(document.getElementById('root')).render(<MyComponent/>);