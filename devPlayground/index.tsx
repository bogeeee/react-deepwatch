import React from "react";
import {createRoot} from "react-dom/client";
import {useWatchedState} from "react-deepwatch/develop";


function App(props) {
    useWatchedState({});
    return <div>hello</div>
}

createRoot(document.body).render(<App/>);