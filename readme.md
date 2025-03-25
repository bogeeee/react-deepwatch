# React Deepwatch - no more setState and less


**Deeply watches your state-object and props** for changes. **Re-renders** automatically😎 and makes you write less code 😊.
- **Performance friendly**  
  React Deepwatch uses a [proxy-facade](https://github.com/bogeeee/proxy-facades) to **watch only for those properties that are actually used** in your component function. It doesn't matter how complex and deep the graph behind your state or props is.
- **Can watch your -model- as well**  
  If a (used) property in props points to your model, a change there will also trigger a re-render. In fact, you can [watch anything](#watched) ;)
# Quick example to show you most features:
````jsx
// Will reload the fruits and show a 🌀 during load, if you type in the filter box.
const MyComponent = watchedComponent(props => {
    const state = useWatchedState({
        filter: "",
        showPrices: false,
    })

    return <div>
        {/* A nice bind syntax. No more 'onChange(...)' code */}
        Filter      <input type="text"     {...bind(state.filter    )} />
        
        {/* state.filter="" will automatically rerender and re-run the following server fetch, if necessary👍 */}
        <input type="button" value="Clear filter" onClick={() => state.filter = ""} />
        
        {/* you can fetch data from **inside** conditional render code or loops😎! No useEffect needed! Knows its dependencies automatically👍 */}        
        <div>Here are the fruits, fetched from the Server:<br/><i>{ load(async ()=> await simulateFetchFruitsFromServer(state.filter), {fallback:"loading list 🌀"} )}</i></div><br/>

        {/* The above load(...) code is independent of state.showPrices, react-deepwatch knows that automatically, so clicking here will NOT exec a re- load(...)👍... */}
        Show prices <input type="checkbox" {...bind(state.showPrices)} />
        {/* showing here, that clicking "show prices" will **only** do a rerender: */}
        {state.showPrices?<div>Free today!</div>:null}
    </div>
});

createRoot(document.getElementById('root')).render(<MyComponent/>);
````
[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/fork/github/bogeeee/react-deepwatch/tree/1.x/examples/less-loading-code?title=react-deepwatch%20example&file=index.jsx)

# Install
````bash
npm install --save react-deepwatch
````

# Usage
## no more setState
````jsx
import {watchedComponent, watched, useWatchedState} from "react-deepwatch"
          
const MyComponent = watchedComponent(props => {
    const state = useWatchedState( {myDeep: {counter: 0, b: 2}}, {/* WatchedOptions (optional) */} );

    return <div>
        Counter is: {state.myDeep.counter}<br/>
      <button onClick={ () => state.myDeep.counter++ /* will trigger a rerender */ }>Increase counter</button>
    </div>
}, {/* WatchedComponentOptions (optional) */});

<MyComponent/> // Use MyComponent
````
[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/fork/github/bogeeee/react-deepwatch/tree/1.x/examples/no-more-setstate?title=react-deepwatch%20example&file=index.jsx)

## and less... loading code
Now that we already have the ability to deeply record our reads, let's see if there's also a way to **cut away the boilerplate code for `useEffect`**.

````jsx
import {watchedComponent, load, poll, isLoading, loadFailed, preserve} from "react-deepwatch"

const MyComponent = watchedComponent(props => {

    return <div>
        Here's something fetched from the Server: {  load( async () => await myFetchFromServer(props.myProperty), {/* LoadOptions (optional) */} )  }
    </div>
});

<MyComponent/> // Use MyComponent
````
[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/fork/github/bogeeee/react-deepwatch/tree/1.x/examples/less-loading-code?title=react-deepwatch%20example&file=index.jsx)

**`load(...)` re-executes `myFetchFromServer`, when a dependent value changes**. That means, it records all reads from previous code in your component function _(which can as well be the result of a previous `load(...)` call)_  plus the reads immediately inside the `load(...)` call. _Here: props.myProperty._
The returned Promise will be await'ed and the component will be put into [suspense](https://react.dev/reference/react/Suspense) that long.  
👍 load(...) can be inside a conditional block or a loop. Then it has already recorded the condition + everything else that leads to the computation of load(...)'s point in time and state 😎._
For this mechanic to work, **make sure, all sources are watched**: `props` and `load(...)`'s result are already automatically watched; For state, use `useWatchedState(...)`; For context, use  `watched(useContext(...))`.

### Show a 🌀loading spinner
To show a 🌀loading spinner / placeholder during load, either...
 - **wrap your component in a [`<Suspense fallback={<div>🌀</div>}>...<MyComponent/>...</Suspense>`](https://react.dev/reference/react/Suspense)**. It can be wrapped at any parent level😎. _Or..._
 - **call isLoading()** inside your component, to probe if any or a certain `load(...)`statement is loading. _See jsDoc for usage example. Mind the caveat of not using it for a condition to cut off a load statement._ _and/or..._   
 - **specify a fallback** value via `load(..., {fallback:"🌀"})`.

### Handle errors
either...
 - **wrap your component in a** [`<ErrorBoundary fallback={<div>Something went wrong</div>}>...<MyComponent/>...</ErrorBoundary>`](https://github.com/bvaughn/react-error-boundary) from the [react-error-boundary](https://github.com/bvaughn/react-error-boundary) package. It can be wrapped at any parent level😎.  
   It tries to recover from errors and re- runs the `loaderFn`, whenever a dependency changes. Note that recovering works only with the mentioned [react-error-boundary 4.x](https://github.com/bvaughn/react-error-boundary) and not with 3rd party error-boundary libraries. _Or..._
 - **try/catch around the load(...)** statement. Caveat: You must check, if caught is `instanceof Promise` and re-throw it then. _Because this is the way for `load` to signal, that things are loading._ _Or..._
 - **call** the **loadFailed()** probing function. This looks more elegant than the above. _See jsDoc for usage example._

### Performance optimization for load(...)
To reduce the number of expensive `myFetchFromServer` calls, try the following:
- Move the load(...) call as upwards in the code as possible, so it depends on fewer props / state / watched objects.
- See the `LoadOptions#fallback`, `LoadOptions#silent` and `LoadOptions#critical` settings.
- Use the `preserve` function on all your fetched data, to smartly ensure non-changing object instances in your app (`newFetchResult` **===** `oldFetchResult`; Triple-equals. Also for the deep result_). Changed object instances can either cascade to a lot of re-loads or result in your component still watching the old instance.
  _Think of it like: The preserve function does for your data, what React does for your component tree: It smartly remembers the instances, if needed with the help of an id or key, and re-applies the re-fetched/re-rendered properties to them, so the object-identity/component-state stays the same._  
  👍 `load(...)` does call `preserve` by default to enforce this paradigm and give you the best, trouble free experience.

### Caveats
- The component function might return and empty `</>` on the first load and **produce a short screen flicker**. This is [because React's Suspense mechasim is not able to remeber state at that time](https://react.dev/reference/react/Suspense#caveats). To circumvent this, specify `WatchedComponentOptions#fallback`.
- `<Suspense>` and `<ErrorBoundary>` inside your component function do not handle/catch loads in that **same** function. _Means: You must place them outside to handle/catch them._
- If your app is a mixed scenario with non-watchedComponents and relies on the old way of fully re-rendering the whole tree to pass deep model data (=more than using shallow, primitive props) to the leaves, mind disabling the WatchedComponentOptions#memo flag.
- SSR is not supported.
- [startTransition](https://react.dev/reference/react/startTransition) is not supported (has no effect).
- As said: Keep in mind that `load(...)` calls `preserve` on its result. It also invalidates (destroys) the "unused" objects. _When they're not really unused any you are trying to access them, You'll get the proper error message how to disable it_.

# And less... handing onChange listeners to child components
Since we have proxy-facades, we can easily hook on, whenever some deep data changes and don't need to manage that with callback- passing to child-child components.
Let's say, we have a form and a child component, that modifies it. We are interested in changes, so we can send the form content to the server.
````jsx
import {watchedComponent, watched, useWatchedState} from "react-deepwatch"
const MyParentComponent = watchedComponent(props => {
    const myState = useWatchedState({
        form: {
            name: "",
            address: ""
        }
    }, {onChange: () => console.log("Something deep inside myState has changed")}); // Option 1: You can hook here

    return <form>        
        <ChildComponentThatModifiesForm form={ // let's pass a special version of myState.form to the child component which calls our onChange handler
            watched(myState.form, {
                onChange: () => {postFormToTheSerer(myState.form); console.log("Somthing under myState.form was changed")} // Option 2: You can also hook here
            })
        }/>
    </form>
});
````
[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/fork/github/bogeeee/react-deepwatch/tree/1.x/examples/onchange-handlers?title=react-deepwatch%20example&file=index.jsx)

_This example will trigger both onChange handlers._

_Note, that `watched(myState.form) !== myState.form`. It created a new proxy object in a new proxy-facade layer here, just for the purpose of deep-watching everything under it. Sometimes you may want to take advantage of it, so that modifications in the originaly layer (in MyParentComponent) won't fire the onChange event / call the postFormToTheSerer function. I.e. for updates that came from the server_

# ...and less onChange code for &lt;input/&gt; elements

Let's make the value binding code a bit easier:
````jsx
import {bind} from "react-deepwatch";

// Old:
<input type="text" value={myState.myValue} onChange={(event) => myState.myValue = event.how.was.that.again.i.just.want.the.value} />

// New:
<input type="text" {...bind(myState.myValue)} />
````
[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/fork/github/bogeeee/react-deepwatch/tree/1.x/examples/bind?title=react-deepwatch%20example&file=index.jsx)

It works for all sorts of input types, not only text👍. Also with [MUI](https://mui.com/) and [Blueprint](https://blueprintjs.com) input components and should work in general with other library components as long as they stick to the standards.  

# Further notes

### watched
You can also use `watched` similarly  to `useWatchedState` to watch any global object. _But in React paradigm, this is rather rare, because values are usually passed as props into your component function._

### poll
Besides `load`, there's also the `poll` function, which works similar, but re-loads in regular intervals. _See jsDoc_

### [Deeper explanation of the mechanics](https://github.com/bogeeee/react-deepwatch/blob/main/react-deepwatch/mechanics.md)

### Similar libraries
There are also other libraries that address proxying the state:  
[valito](https://github.com/pmndrs/valtio), [react-easy-state](https://github.com/RisingStack/react-easy-state), [wana](https://www.npmjs.com/package/wana),

while React-deepwatch set's its self apart in these areas:
- Deep (not only shallow-) proxying
- Tracking changes above **and** below the proxy = also on the unproxied object.
- Fully transparent support for `this`, getters/setters (treated white box), user's methods, Sets, Maps, Arrays _(wana seems to support Sets,Maps, Arrays too)_
- Very comprehensive `load(...)` concept with auto dependencies, fallbacks, probing functions, instance preserving mechanism, possible in conditionals/loops, supports polling, error boundaries.  
- &lt;Input/&gt;  bind(...)ing

### Simplify the server side as well
If you like, how this library simplifies things for you and want to write the backend (http) endpoints behind your load(...) statements simply as typescript methods, have a look at my flagship project [Restfuncs](https://github.com/bogeeee/restfuncs).
Example: 
````typescript
// In your watchedComponent function:
return <div>The greeting's result from server is: {  load( async () => await myRemoteSession.greet(state.name) )  }</div>

// On the server:
...
@remote greet(name: string) {
    return `Hello ${name}` 
}
...
````
_The example leaves away all the the setup-once boilerplate code.  
Also in your tsx, you can enjoy type awareness / type safety and IDE's code completion around `myRemoteSession.greet` and all its parameters and returned types, which is a feature that only rpc libraries can offer (Restfuncs is such one)😎_