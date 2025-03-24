import React from "react";
import {createRoot} from "react-dom/client";
import {watchedComponent, useWatchedState, watched, load, poll, isLoading, loadFailed, preserve, bind} from "react-deepwatch"

// async function that returns fruits after one second
function simulateFetchFruitsFromServer(filter) {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            resolve(["Apple", "Banana", "Cherry", "Date", "Fig", "Grape", "Kiwi", "Lemon", "Mango", "Orange", "Peach", "Pear", "Pineapple", "Pomegranate", "Raspberry", "Strawberry", "Tangerine", "Watermelon"].filter(f => !filter || f.toLowerCase().indexOf(filter.toLowerCase()) >= 0).join(", "))
        }, 1000)
    })
}

// Will reload the fruits and show a 🌀 during load, if you type in the filter box.
const MyComponent = watchedComponent(props => {
    const state = useWatchedState({
        filter: "",
        showPrices: false,
    })

    return <div>
        {/* A nice bind syntax. No more 'onChange(...)' code */}
        Filter      <input type="text"     {...bind(state.filter    )} />

        {/* state.filter="" will automatically rerender / re-run the load(...), if necessary👍 */}
        <input type="button" value="Clear filter" onClick={() => state.filter = ""} />

        {/* you can fetch data from **inside** conditional render code or loops😍! No useEffect needed! Knows its dependencies automatically👍 */}
        <div>Here are the fruits, fetched from the Server:<br/><i>{ load(async ()=> await simulateFetchFruitsFromServer(state.filter), {fallback:"loading list 🌀"} )}</i></div><br/>

        {/* The above load(...) code is independent of state.showPrices, react-deepwatch knows that automatically, so clicking here will NOT exec a re- load(...)👍 */}
        Show prices <input type="checkbox" {...bind(state.showPrices)} />

        {state.showPrices?<div>Free today!</div>:null}
    </div>
});

createRoot(document.getElementById('root')).render(<MyComponent/>);