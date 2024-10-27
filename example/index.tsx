import React from "react";
import {createRoot} from "react-dom/client";

function App(props) {
    return <div>hello</div>
}

createRoot(document.getElementById('root')!).render(<App/>);