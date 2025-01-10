# Proxy facades
TODO

##Does not support
- cloning proxied objects (if clone sets the same, shared prototype)
- Deleting properties with the `delete` operator. It cannot be tracked. Use the `deleteProperty` function therefore
- Modifications on the prototype are not tracked.
- Altering the prototype chain
- Subclassing `Array`, `Set` and `Map`