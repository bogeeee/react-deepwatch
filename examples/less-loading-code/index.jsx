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

// Will reload the fruits and show a 🌀, if you type in the filter box. Will not reload them, when you change the show prices checkbox, because react-deepwatch sees, that load(...) does not depend on it;)
const MyComponent = watchedComponent(props => {
    const state = useWatchedState({
        filter: "",
        showPrices: false,
    })

    return <div>
        Filter      <input type="text"     {...bind(state.filter    )} />
        <input type="button" value="Clear filter" onClick={() => state.filter = ""} />
        <div>Here are the fruits, fetched from the Server:<br/><i>{ load(async ()=> await simulateFetchFruitsFromServer(state.filter), {fallback:"loadinng list 🌀"} )}</i></div><br/>
        Show prices <input type="checkbox" {...bind(state.showPrices)} />
        {state.showPrices?<div>Free today!</div>:null}
    </div>
});

createRoot(document.getElementById('root')).render(<MyComponent/>);