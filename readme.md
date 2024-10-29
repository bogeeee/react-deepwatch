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
          
const MyComponent = WatchedComponent((props) => {
    const state = useWatchedState({myDeep: {counter: 0, b: 2}});

    return <div>
        Counter is: {state.myDeep.counter}
      <button onClick={ () => state.myDeep.counter++ /* will trigger a rerender */ }>Increase counter</button>
    </div>
});

<MyComponent/> // Use MyComponent
````

## and less... loading code
Now that we already have the ability to deeply record our reads, let's see if there's also a way to **cut away the boilerplate code for `useEffect`**.

````jsx
import {WatchedComponent, load} from "react-deepwatch"

const MyComponent = WatchedComponent((props) => {

    return <div>
        Here's something fetched from the Server: { load(() => myFetchFromServer(props.myProperty)) }
    </div>
});

<MyComponent/> // Use MyComponent
````
**`load(...)` re-executes `myFetchFromServer`, when a dependent value changes**. That means, it records all reads from previous code in your component function plus the reads immediately inside the `load(...)` call. _Here: props.myProperty._
The returned Promise will be await'ed and the component will be put into suspense that long.  
_👍 load(...) can be inside a conditional block or a loop. Then it has already recorded the condition + everything else that leads to the computation of load(...)'s point in time and state 😎_

#Playground
[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz_small.svg)](https://stackblitz.com/fork/github/bogeeee/react-deepwatch/tree/1.x/example?title=MembraceDb%20example&file=index.ts). _Not working with StackBlitz on Firefox currently. Ignore the ever-spinning "Installing dependencies"._

#Further notes
### useWatched
You can also use `useWatched` similarly  to `useWatchedState` to watch any global object. _But in react paradigm, this is rather rare, because values are usually passed as props and state into your component function._
