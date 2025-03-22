# Deeper explanation of the mechanics
## Re-rendering
- A watchedComponents is re-rendered **by React from the outside**, only when shallow properties change. It uses React's [memo](https://react.dev/reference/react/memo) therefore. See the `WatchedComponentOptions#memo` flag.
- A watchedComponents re-renders it's self when a property, that is actually "read" inside the render function (=component function), later changes. This is from these (root) sources:
    - the `props`
    - the `useWatchedState`
    - a `watched(useContext(...))`
    - a `watched` external / global object
    - the result of a `load(...)` statement


So, what is a "read"? tl;dr: Just everything anywhere that reads from the above mentioned:
  ````javascript
    //# Directly:
    {props.myProp} // this is a read (outputting in jsx)
    console.log(props.myProp) // this is a read
    props.myProp // this is a (useless) read
    
    //# Reads from inside other code (or libraries) are recorded too ;):
    function myFunc(props) {
        return props.myModel.users; // this is two reads.
    }
    myFunc(props); // this is not a read it's self.
    
    //# Getters / setters are treated as whitebox. Just like functions:
    const myState = useWatchedState({
        get logonUser() {
            return this._logonUser; // this is a read
        }
    })
    myState.logonUser; // this is not a read it's self.

    //# Reads are also recorded on Sets, Maps and Arrays:
    const myStateWithSet = useWatchedState(new Set(["a","b"]))
    myStateWithSet.has("c"); // This is a read and a re-render will be triggerd if someone does myStateWithSet.add("c") later
  ````

Change tracking works also (by default), if these properties are changed externally / from the outside / not through the proxy-facade that you see in the render function. See `WatchedComponentOptions#watchOutside`.  
_Thanks to the mothers and fathers of Ecmascript to make all this possible through fancy proxy tricks ;)_
- _Besides that, re-renders can be made for operational purposes: to display the state change of a load or to serve the isLoading() and loadFailed() probing functions, etc..._

## Re-loading
The `loaderFn` from inside the `load(...)` statements is re-executed, when:
- A property, that is read immediately in the `loaderFn`, later changes. _Immediately = in the same sync block / not after an awaited i/o operation._
- The precondition changes: Meaning, those reads that were done **before** the `load(...)` statement, their value later changes.

For this to work, your component function must be pure / deterministic against all watched sources (listed [above](#re-rendering)), meaning: **Your component function must not use any non-watched source!**
