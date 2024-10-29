import React, {useState} from "react";
import {createRoot} from "react-dom/client";
import {WatchedComponent, useWatchedState} from "react-deepwatch/develop";

function renderCounter(msg: string) {
    const [state] = useState({counter: 0});
    return <div><i>Rendercounter: {state.counter++}</i> - {msg}<br/><br/></div>
}


const BasicCounter = WatchedComponent((props) => {
    const state = useWatchedState({myDeep: {counter: 0, b: 2}});

    return <div>
        <h3>BasicCounter</h3>
        {renderCounter("should be increased on button click")}

        <div>Counter is: {state.myDeep.counter}</div>
        <button onClick={ () => state.myDeep.counter++ /* will trigger a rerender */ } >Increase counter</button>
    </div>
});

function App(props) {
    return <div>
        <BasicCounter />
        <hr/>
    </div>
}

createRoot(document.getElementById("root")).render(<App/>);