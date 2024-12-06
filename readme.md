# React Deepwatch - no more setState and less
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!  !!!!!!!!!!!!!!!!!!!!  !!!!!!!!!!!!!!!!!!!!  !!!!!!!!!!!!!!!!!!!!  !!!!!!!!!!!!!!!!!!!!!!!  
**!!!! Concept code. Not yet working. Greetings to Brillout and aleclarson !!!!**  
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!


**Deeply watches your state-object and props** for changes. **Re-renders** automatically😎 and makes you write less code 😊.
- **Performance friendly**  
  React Deepwatch uses recursive [proxies](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy) to **watch only for those properties that are actually used** in your component function. It doesn't matter how complex and deep the graph behind your state or props is.
- **Can watch your -model- as well**  
  If a (used) property in props points to your model, a change there will also trigger a re-render. In fact, you can [watch anything](#usewatched) ;)

# Install
````bash
npm install --save react-deepwatch
````

# Usage
## no more setState
````jsx
import {WatchedComponent, useWatched, useWatchedState} from "react-deepwatch"
          
const MyComponent = WatchedComponent(props => {
    const state = useWatchedState( {myDeep: {counter: 0, b: 2}}, {/* WatchedOptions (optional) */} );

    return <div>
        Counter is: {state.myDeep.counter}
      <button onClick={ () => state.myDeep.counter++ /* will trigger a rerender */ }>Increase counter</button>
    </div>
}, {/* WatchedComponentOptions (optional) */});

<MyComponent/> // Use MyComponent
````

## and less... loading code
Now that we already have the ability to deeply record our reads, let's see if there's also a way to **cut away the boilerplate code for `useEffect`**.

````jsx
import {WatchedComponent, load, poll, isLoading, loadFailed} from "react-deepwatch"

const MyComponent = WatchedComponent(props => {

    return <div>
        Here's something fetched from the Server: {  load( () => myFetchFromServer(props.myProperty), {/* LoadOptions (optional) */} )  }
    </div>
});

<MyComponent/> // Use MyComponent
````
**`load(...)` re-executes `myFetchFromServer`, when a dependent value changes**. That means, it records all reads from previous code in your component function plus the reads immediately inside the `load(...)` call. _Here: props.myProperty._
The returned Promise will be await'ed and the component will be put into [suspense](https://react.dev/reference/react/Suspense) that long.  
_👍 load(...) can be inside a conditional block or a loop. Then it has already recorded the condition + everything else that leads to the computation of load(...)'s point in time and state 😎._  

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
- See the `LoadOptions#fallback` and `LoadOptions#critical` settings. This can allow loading in parallel as well.

### Caveats
- The component function might return and empty `</>` on the first load and **produce a short screen flicker**. This is [because React's Suspense mechasim is not able to remeber state at that time](https://react.dev/reference/react/Suspense#caveats). To circumvent this, specify `WatchedComponent#fallback`.
- `<Suspense>` and `<ErrorBoundary>` inside your component function do not handle/catch loads in that **same** function. _Means: You must place them outside to handle/catch them._
- If your app is a mixed scenario with non-watchedComponents and relies on the old way of fully re-rendering the whole tree to pass deep model data (=more than using shallow, primitive props) to the leaves, mind disabling the WatchedComponentOptions#memo flag.
- SSR is not supported.
- [startTransition](https://react.dev/reference/react/startTransition) is not supported (has no effect).

#Playground
[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz_small.svg)](https://stackblitz.com/fork/github/bogeeee/react-deepwatch/tree/1.x/example?title=react-deepwatch%20example&file=index.ts). _Not working with StackBlitz on Firefox currently. Ignore the ever-spinning "Installing dependencies"._

#Further notes
### useWatched
You can also use `useWatched` similarly  to `useWatchedState` to watch any global object. _But in react paradigm, this is rather rare, because values are usually passed as props into your component function._
### poll
Besides `load`, there's also the `poll` function, which works similar, but in regular intervals. _See jsDoc_
