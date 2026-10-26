import "./zod-config.ts";
import { need } from "./safe.ts";
import { render } from "preact";
import { App } from "./ui/App.tsx";
import "./ui/fonts.ts";
import "./ui/styles.css";

render(<App />, need(document.getElementById("app"), "#app mount element"));
