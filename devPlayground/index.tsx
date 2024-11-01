import React, {useState, Suspense} from "react";
import {createRoot} from "react-dom/client";
import {WatchedComponent, useWatchedState, load} from "react-deepwatch/develop";
import {Simulate} from "react-dom/test-utils";


function renderCounter(msg: string) {
    const [state] = useState({counter: 0});
    return <div><i>Rendercounter: {++state.counter}</i> - {msg}<br/><br/></div>
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
        {renderCounter("should be increased on button1 click")}

        <div>Counter is: {state.myDeep.counter}</div>
        <button onClick={ () => state.myDeep.counter++ /* will trigger a rerender */ } >1: Increase counter</button>
    </div>
});

const ShouldNotRerender = WatchedComponent((props) => {
    const state = useWatchedState({myDeep: {counter: 0, b: 2}, someObj:{isSome: true}});

    return <div>
        <h3>ShouldNotRerender</h3>
        {renderCounter("")}

        <div>Counter is: {state.myDeep.counter}</div>
        <div>someObj is: {JSON.stringify((state.someObj))}</div>
        <button onClick={ () => state.myDeep.counter =  0} >counter = 0</button><i>should not rerender</i><br/>
        <button onClick={ () => {state.myDeep.counter++;state.myDeep.counter++;}}>counter++;counter++</button><i>should not fire rerender twice</i><br/>
        <button onClick={ () => state.someObj = state.someObj}>state.someObj = state.someObj</button><i>Should rerender max.1 time or better not at all</i>
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


let ShouldReLoadIfStateChanges_fetchCounter = 0;
let ShouldReLoadIfStateChanges_fetchCounter2 = 0;

const ShouldReLoadIfStateChanges = WatchedComponent((props) => {
    const state = useWatchedState({counter1: 0, counter2:0});

    return <div>
        <h3>ShouldReLoadIfStateChanges</h3>
        {renderCounter("should be increased on button click")}
        <div>counter1: {state.counter1}</div>
        {/* Dont display counter2: we don't want to trigger refreshes on changes this way but want to see, if changes cause re executing the loader */}

        <div>Retrieve counter1 dependant: {load( async () => { return `counter: ${state.counter1}, fetched ${++ShouldReLoadIfStateChanges_fetchCounter} times - should increase on button 1 only`})}</div>
        <div>Retrieve counter2 dependant: {load( async () => { return `counter: ${state.counter2}, fetched ${++ShouldReLoadIfStateChanges_fetchCounter2} times - should increase on button 2 only`})}</div>

        <button onClick={ () => state.counter1++} >1: Increase counter1</button><br/>
        <button onClick={ () => state.counter2++} >2: Increase counter2</button>
    </div>
});


let ShouldReLoadIfPropsPropertyChanges_fetchCounter = 0;
const ShouldReLoadIfPropsPropertyChanges_Child = WatchedComponent((props: {myProp:number, myProp2: number}) => {
    return <div>
        Child: myProp: { load(async () => {return `${props.myProp}, fetchCounter: ${ShouldReLoadIfPropsPropertyChanges_fetchCounter++}`}) }
    </div>
});

const ShouldReLoadIfPropsChange = WatchedComponent((props) => {
    const state = useWatchedState({counter: 0, counter2:0});

    return <div>
        <h3>ShouldReLoadIfPropsPropertyChanges</h3>

        <ShouldReLoadIfPropsPropertyChanges_Child myProp={state.counter} myProp2={state.counter2} />

        <button onClick={ () => state.counter++ } >Increase counter</button>  <i>Should increase Child: myProp: ... and fetchCounter: ...</i><br/>
        <button onClick={ () => state.counter2++} >Increase counter2</button> <i>Should not increase...</i>
    </div>
});

function App(props) {
    return <div>
        <Suspense fallback={<div>Loading</div>}>
            <BasicCounter/>
            <hr/>
            <ShouldNotRerender/>
            <hr/>
            <WatchProps/>
            <hr/>
            <ShouldReLoadIfStateChanges/>
            <hr/>
            <ShouldReLoadIfPropsChange/>
        </Suspense>
    </div>
}

createRoot(document.getElementById("root")).render(<App/>);