import "@fontsource-variable/sora";
import { render } from "solid-js/web";
import App from "./App";
import "./styles/app.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Missing #root mount element in index.html");
}

render(() => <App />, root);
