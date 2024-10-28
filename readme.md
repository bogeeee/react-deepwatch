# React Deepwatch - no more setState!
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!  !!!!!!!!!!!!!!!!!!!!  !!!!!!!!!!!!!!!!!!!!  !!!!!!!!!!!!!!!!!!!!  !!!!!!!!!!!!!!!!!!!!!!!  
**!!!! Concept code. Not yet working. Greetings to Brillout and aleclarson !!!!**  
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!


**Watches** your **state**-object **and** also your **props** **deeply** for changes **and re-renders** your component automatically.
- **Performance friendly**  
  React Deepwatch uses proxies to watch only for those properties that are actually **used** in your component function, meaning, it records when it makes a read.
- **Can watch your -model- as well**  
  Theoretically, if a property in props points to your **model**, a change there will also trigger a re-render.
  _The react paradigm says that props are read only but that means only the first level and not your model._


# Usage
````jsx
const MyComponent = WatchedComponent((props) => {
    const state = useWatchedState({myDeep: {counter: 0, b: 2}});

    return <div>
        Counter is: {state.myDeep.counter}
        <Button onclick={state.myDeep.counter++}/>
    </div>
});

<MyComponent/> // Use MyComponent
````

# Another handy utitily: load()
Now that we already have the ability to deeply record our reads, let's there's also a way to cut away our boilerplate code for `useEffect`  
## Usage
````jsx
const MyComponent = WatchedComponent((props) => {
    const state = useWatchedState({myDeep: {counter: 0, b: 2}});

    return <div>
        <span>Here's something fetched from the Server: {load(() => fetchFromServer(state.myDeep.counter))} </span>
        <Button onclick={state.myDeep.counter++}/>
    </div>
});

<MyComponent/> // Use MyComponent
````
**It re-executes `fetchFromServer` when a dependent value changes**. That means, it records all reads from previously in your component function plus reads immediately inside the `load(...)` call. _Here: state.myDeep.counter_   
The returned Promise is awaited and the component will be put into suspense automatically.

#Example
[On github](https://github.com/bogeeee/react-deepwatch/tree/1.x/example) or  [![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz_small.svg)](https://stackblitz.com/fork/github/bogeeee/react-deepwatch/tree/1.x/example?title=MembraceDb%20example&file=index.ts). _Not working with StackBlitz on Firefox currently. Ignore the ever-spinning "Installing dependencies"._ 
