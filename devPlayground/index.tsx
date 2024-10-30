import React, {useState} from "react";
import {createRoot} from "react-dom/client";
import {WatchedComponent, useWatchedState} from "react-deepwatch/develop";

function renderCounter(msg: string) {
    const [state] = useState({counter: 0});
    return <div><i>Rendercounter: {state.counter++}</i> - {msg}<br/><br/></div>
}

function useUtil() {
    const globalObj = {
        counter: 0
    }
    return {globalObj,  globalObjCtl: <div><button onClick={ () => globalObj.counter++} >globalObj: Increase counter</button></div>}
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

const WatchProps = WatchedComponent((props) => {
    const WatchProps_Child = WatchedComponent((props: {globalObj: any, someOtherProp: boolean}) => {
        return <div>
            {renderCounter("should be increased on button click")}
            <div>Should increase on click: {props.globalObj.counter}</div>
            <div>Should be true: {"" + props.someOtherProp}</div>
        </div>
    });

    const util = useUtil();

    return <div>
        <h3>WatchProps</h3><i>(needs to watch for **external** changes not through the proxy)</i>
        {util.globalObjCtl}
        <WatchProps_Child globalObj={util.globalObj} someOtherProp={true} />
    </div>
});

function App(props) {
    return <div>
        <BasicCounter />
        <hr/>
        <WatchProps/>
        <hr/>
    </div>
}

createRoot(document.getElementById("root")).render(<App/>);