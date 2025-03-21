import React, {useState, Suspense, memo} from "react";
import {createRoot} from "react-dom/client";
import {watchedComponent, useWatchedState, load, debug_tagComponent, isLoading, loadFailed} from "react-deepwatch/develop";
import {Simulate} from "react-dom/test-utils";
import {ErrorBoundary} from "react-error-boundary";

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

function delayed(fn: () => unknown, delay = 1000, returnError= false) {
    return async () => {
        const result = await fn();
        if(delay === 0) {
            if(returnError) {
                throw new Error("Intended error");
            }
            return result;
        }

        return await new Promise((resolve, reject) => {
            setTimeout(() => {
                if(returnError) {
                    reject(new Error("Intended error") )
                }
                else {
                    resolve(result);
                }
            }, delay);
        })
    }
}


const BasicCounter = watchedComponent((props) => {
    const state = useWatchedState({myDeep: {counter: 0, b: 2}});

    return <div>
        <h3>BasicCounter</h3>
        {renderCounter("should be increased on button1 click")}

        <div>Counter is: {state.myDeep.counter}</div>
        <button onClick={ () => state.myDeep.counter++ /* will trigger a rerender */ } >1: Increase counter</button>
    </div>
});

const ShouldNotRerender = watchedComponent((props) => {
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

const WatchProps = watchedComponent((props) => {
    const WatchProps_Child = watchedComponent((props: {globalObj: any, someOtherProp: boolean}) => {
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
let ShouldReLoadIfStateChanges_fetchCounter3= 0;

/**
 * Also an inner component, which does not rerender automatically if any state change so we can test if it really detects them from the reads inside the loaderFn
 */
const ShouldReLoadIfStateChanges3_Inner = memo(watchedComponent((props) => {
    return <div>Retrieve counter3 dependant: {load(delayed(() => {
        return `counter: ${props.model.counter3}, fetched ${++ShouldReLoadIfStateChanges_fetchCounter3} times - should increase on button 3 only`
    }, props.model.withDelay ? 1200 : 0), {fallback: "Loading"})}  - (inner component)</div>
}));

const ShouldReLoadIfStateChanges = watchedComponent((props) => {
    const state = useWatchedState({
        counter1: 0,
        counter2:0,
        counter3:0,
        withDelay: true,
    });

    return <div>
        <h3>ShouldReLoadIfStateChanges</h3>
        {renderCounter("should be increased by 3 on button click")}
        <div>counter1: {state.counter1}</div>
        {/* Dont display counter2: we don't want to trigger refreshes on changes this way but want to see, if changes cause re executing the loader */}

        <div>Retrieve counter1 dependant: {load( delayed( () => { return `counter: ${state.counter1}, fetched ${++ShouldReLoadIfStateChanges_fetchCounter} times - should increase on button 1 only`},state.withDelay?1000:0), {fallback: "Loading"})}</div>
        <div>Retrieve counter2 dependant: {load( delayed( () => { return `counter: ${state.counter2}, fetched ${++ShouldReLoadIfStateChanges_fetchCounter2} times - should increase on button 2 only`}, state.withDelay?500:0), {fallback: "Loading2"})}</div>
        <ShouldReLoadIfStateChanges3_Inner model={state}/>

        <button onClick={ () => state.counter1++} >1: Increase counter1</button><br/>
        <button onClick={ () => state.counter2++} >2: Increase counter2</button><br/>
        <button onClick={ () => state.counter3++} >3: Increase counter3</button><br/>
        <input type="checkbox" checked={state.withDelay} onChange={(event) => {
            state.withDelay = event.target.checked}} />with delay
    </div>
});

const itemsFetchCounter: Record<string, number> = {};
const itemsFetchCounter_incr = (name: string) => {
    const result = itemsFetchCounter[name] = (itemsFetchCounter[name] || 0)+1;
    if(name === "item2" && result > 0 && result % 20 === 0) {
        throw new Error("I'm item2 and i don't like numbers devideable by 20")
    }
    return result;
}
const MultipleLoadsInALoop = watchedComponent((props) => {
    const state = useWatchedState({
        withFallbacks: false,
        withIsLoadingIndicator: false,
        returnOnIsLoading: false,
        critical: true,
        silent: false,
        globalCounter:0,
        items: [{name: "item1", counter:0, poll:false},{name: "item2", counter:0, poll: false},{name: "item3", counter:0, poll:false},{name: "item4", counter:0, poll:false}]
    });

    const globalCounter = state.globalCounter;

    const theRenderCounter = renderCounter("expected to increase reasonably" );

    if(state.withIsLoadingIndicator && state.returnOnIsLoading && isLoading()) {
        return "🌀 "
    }

    return <div>
        <h3>MultipleLoadsInALoop</h3>
        {theRenderCounter}
        {(state.withIsLoadingIndicator && isLoading())?"🌀 ":null}
        {state.items.map(item => <div key={item.name}>
            <b>{item.name}</b>&#160;
            Retrieve item.counter's dependant: {load(
                delayed(() => {
                    if(item.name === "item3") { return {msg: `counter: ${item.counter} (no fetch stats. polling should not re-render)`}}
                    return {msg: `counter: ${item.counter},  fetched ${itemsFetchCounter_incr(item.name)} times. globalCounter:${globalCounter}`}
                }, 500),
            {key: item.name, name: item.name, interval: item.poll?1000:undefined, silent: state.silent, ...(state.withFallbacks?{fallback: {msg:"fallback"}, critical: state.critical}:{})}
        ).msg}
            &#160;<button onClick={ () => item.counter++} >Increase items's counter</button> {(state.withIsLoadingIndicator && isLoading(item.name))?"⬅️🌀 ":null}
            &#160;<input type="checkbox" checked={item.poll} onChange={(event) => {item.poll = event.target.checked}} />poll
        </div>)}

        <input type="checkbox" checked={state.withFallbacks} onChange={(event) => {
            state.withFallbacks = event.target.checked}} />withFallbacks
        <input type="checkbox" checked={state.withIsLoadingIndicator} onChange={(event) => {
            state.withIsLoadingIndicator = event.target.checked}} />with isLoading() indicator
        <input type="checkbox" disabled={!state.withIsLoadingIndicator} checked={state.returnOnIsLoading} onChange={(event) => {
        state.returnOnIsLoading = event.target.checked}} />return on isLoading()
        <input type="checkbox" checked={state.silent} onChange={(event) => {
            state.silent = event.target.checked}} />silent
        <input type="checkbox" checked={state.critical} onChange={(event) => {
            state.critical = event.target.checked}} />critical

        <br/><button onClick={ () => state.globalCounter++} >Increase globalCounter</button><i>Should load in parallel if the above features are flipped</i>
    </div>
}, {memo: false});


let innerSuspense_inner_fetchCounter = 0;
const InnerSuspense_Inner = watchedComponent( (props: {model: {counter: number}}) => {
    return <div>Result of InnerSuspense_Inner fetch: {load(delayed(() => `counter: ${props.model.counter}, fetched ${++innerSuspense_inner_fetchCounter} times`, 1000), {})}</div>
});

let innerSuspense_fetchCounter = 0;
const InnerSuspense = watchedComponent(props => {
    const state = useWatchedState({counter:0});
    return <div>
        <h3>InnserSuspense</h3>
        Result of fetch: {load(delayed(() => `counter: ${state.counter}, fetched ${++innerSuspense_fetchCounter} times`, 1000), {})}<br/>
        <Suspense fallback="inner suspense: loading...">

            <InnerSuspense_Inner model={state}/>
        </Suspense>
        <br/>
        <button onClick={() => state.counter++}>Increase counter</button>
    </div>
});

const ShouldReactToOtherPropChangesWhileLoading_Inner = new watchedComponent(props => {
    const model = props.model;

    //if(loadFailed()) return "Load failed: " + loadFailed().message

    return <div>
        {!model.canceled?
            <div>Result of fetch: {load(delayed(() => `counter: ${model.counter}`, 2000, model.shouldReturnAnError), model.withFallbacks?{fallback: "loading..."}:{})}</div>:
            <div>Canceled</div>}
    </div>
})

const ShouldReactToOtherPropChangesWhileLoading_Inner_WithOwnComponentFallback = new watchedComponent(props => {
    const model = props.model;

    //if(loadFailed())  return "Load failed: " + loadFailed().message;

    return <div>
        {!model.canceled?
            <div>Result of fetch: {load(delayed(() => `counter: ${model.counter}`, 2000, model.shouldReturnAnError), model.withFallbacks?{fallback: "loading..."}:{})}</div>:
            <div>Canceled</div>}
    </div>
}, {fallback: <div>Loading with WatchedComponentOptions#fallback...</div>})

const ShouldReactToOtherPropChangesWhileLoading = new watchedComponent(props => {
    const state = useWatchedState({counter:0, withFallbacks: false, canceled: false, shouldReturnAnError: false});

    return <div>
        <h3>ShouldReactToOtherPropChangesWhileLoading</h3>
        <ExampleErrorBoundary>
        <Suspense fallback={<div>Loading...</div>}>
            <ShouldReactToOtherPropChangesWhileLoading_Inner model={state} />
        </Suspense>
        <ShouldReactToOtherPropChangesWhileLoading_Inner_WithOwnComponentFallback model={state}/>
        </ExampleErrorBoundary>
        <input type="checkbox" checked={state.withFallbacks} onChange={(event) => {
            state.withFallbacks = event.target.checked}} />withFallback<br/>
        <button onClick={() => state.counter++}>Increase counter</button>&#160;
        <input type="checkbox" checked={state.canceled} onChange={(event) => {state.canceled = event.target.checked}} />Canceled <i>Should interrupt the loading **immediately**</i>
        <br/>
        <input type="checkbox" checked={state.shouldReturnAnError} onChange={(event) => {state.shouldReturnAnError = event.target.checked}} />Return error <i>When unchecking, it should recover</i>
    </div>
})


let ShouldReLoadIfPropsPropertyChanges_fetchCounter = 0;
const ShouldReLoadIfPropsPropertyChanges_Child = watchedComponent((props: {myProp:number, myProp2: number}) => {
    return <div>
        Child: myProp: { load(async () => {return `${props.myProp}, fetchCounter: ${ShouldReLoadIfPropsPropertyChanges_fetchCounter++}`}) }
    </div>
});

const ShouldReLoadIfPropsChange = watchedComponent((props) => {
    const state = useWatchedState({counter: 0, counter2:0});

    return <div>
        <h3>ShouldReLoadIfPropsPropertyChanges</h3>

        <ShouldReLoadIfPropsPropertyChanges_Child myProp={state.counter} myProp2={state.counter2} />

        <button onClick={ () => state.counter++ } >Increase counter</button>  <i>Should increase Child: myProp: ... and fetchCounter: ...</i><br/>
        <button onClick={ () => state.counter2++} >Increase counter2</button> <i>Should not increase...</i>
    </div>
});

const CheckBox = watchedComponent((props: {model: {value: boolean}}) => {
    return <input type="checkbox" checked={props.model.value} onChange={(event) => {props.model.value = event.target.checked}} />
});

const LoadErrorsImmediately_inner = watchedComponent((props: {model: {value: boolean}}) => {
    debug_tagComponent("LoadErrorsImmediately_inner");
    return load(async () => {
        if(props.model.value) throw new Error("This error should be displayed immediately");
        return "ok";
    });

});

const LoadErrorsImmediately = watchedComponent(props => {
    const state = useWatchedState({value: true});

    return <div>
        <h3>LoadErrorsImmediately</h3>
        <ExampleErrorBoundary><LoadErrorsImmediately_inner model={state}/></ExampleErrorBoundary>
        <br/><CheckBox model={state} />Throw error <i>Unchecking should recover</i></div>

});

const ShouldReactToChildComponentsFormChange_Child = (props: {form: {name: string}}) => {
    return <span>
        Name: <input type="text" value={props.form.name} onChange={(event) => props.form.name = event.target.value} />
    </span>
};

const ShouldReactToChildComponentsFormChange = watchedComponent(props => {
    const state = useWatchedState({form: {
            name: "",
            address: ""
        }});

    return <div>
        <h3>ShouldReactToChildComponentsFormChange</h3>
        <ShouldReactToChildComponentsFormChange form={state.form} />
        <div>{JSON.stringify(state)}</div>
    </div>
});

const ExampleErrorBoundary = (props) => {
    return <ErrorBoundary fallbackRender={({ error, resetErrorBoundary }) => <div>Error: {error.message}</div> }>
        {props.children}
    </ErrorBoundary>
}

function App(props) {
    const [powerOff, switchPoperOff] = useState(false);
    if(powerOff) {
        return <div>Shut down. Listeners should be 0. (Note: Components that errored and are currently caught by in an ErrorBoundary, like LoadErrorsImmediately, leak their listeners. This is by reacts design/cannot prevent this) </div>
    }
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
            <ExampleErrorBoundary>
                <Suspense fallback={<div>Loading</div>}>
                    <MultipleLoadsInALoop/>
                </Suspense>
            </ExampleErrorBoundary>
            <hr/>
            <Suspense fallback="Outer suspense: loading...">
                <InnerSuspense/>
            </Suspense>
            <hr/>
                <Suspense fallback="Outer suspense: loading...">
                    <ShouldReactToOtherPropChangesWhileLoading/>
                </Suspense>
            <hr/>
            <Suspense fallback="loading...">
                <ExampleErrorBoundary>
                    <LoadErrorsImmediately/>
                </ExampleErrorBoundary>
            </Suspense>
            <hr/>
            <ShouldReLoadIfPropsChange/>
            <hr/>
            <ShouldReactToChildComponentsFormChange/>
            <hr/>
            <button onClick={() => switchPoperOff(true)}>Shut down all components!</button>
        </Suspense>
    </div>
}

createRoot(document.getElementById("root")).render(<App/>);