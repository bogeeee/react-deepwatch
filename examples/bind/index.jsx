import React from "react";
import {createRoot} from "react-dom/client";
import {watchedComponent, useWatchedState, watched, load, poll, isLoading, loadFailed, preserve, bind} from "react-deepwatch"

const MyComponent = watchedComponent(props => {
    const myState = useWatchedState({
        text: "hello",
        boolean: true,
        number: 0.5,

        // Demonstrate, that the bind syntax works on getters/setters too😎
        get numberInPercent() {
            return this.number * 100;
        },
        set numberInPercent(value) {
            this.number = value / 100;
        },

        selectedItem: "apple",
    });

    return <form>

        text:            <input type="text"     {...bind(myState.text)}           /><br/>
        boolean:         <input type="checkbox" {...bind(myState.boolean)}        /><br/>
        number:          <input type="number"   {...bind(myState.number)}         /><br/>
        numberInPercent: <input type="number"   {...bind(myState.numberInPercent)}/><br/>
        selectedItem: <select{...bind(myState.selectedItem)}>
                        <option>Please choose</option>
                        <option value="apple">Apple</option>
                        <option value="cherry">Cherry</option>
                    </select><br/>

        <hr/>
        State: <pre>{JSON.stringify(myState, undefined, "    ")}</pre>
    </form>
}, {/* WatchedComponentOptions (optional) */});

createRoot(document.getElementById('root')).render(<MyComponent/>);