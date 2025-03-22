import React from "react";
import {createRoot} from "react-dom/client";
import {watchedComponent, useWatchedState, watched, load, poll, isLoading, loadFailed, preserve} from "react-deepwatch"


function postFormToTheSerer(form) {

}

const MyChildComponentThatModifiesForm = watchedComponent((props) => {
    return <div>
        Name: <input type="text" value={props.form.name} onChange={(event) => props.form.name = event.target.value} /><br/>
        Adress: <input type="text" value={props.form.address} onChange={(event) => props.form.address = event.target.value} />
    </div>
});

const MyParentComponent = watchedComponent(props => {
    const myState = useWatchedState({
        form: {
            name: "",
            address: ""
        }
    }, {onChange: () => console.log("Something deep inside myState has changed")}); // Option 1: You can hook here

    return <form>
        <MyChildComponentThatModifiesForm form={ // let's pass a special version of myState.form to the child component which calls our onChange handler
            watched(myState.form, {
                onChange: () => {postFormToTheSerer(myState.form); console.log("Somthing under myState.form was changed")} // Option 2: You can also hook here
            })
        }/>
    </form>
}, {/* WatchedComponentOptions (optional) */});

createRoot(document.getElementById('root')).render(<MyParentComponent/>);