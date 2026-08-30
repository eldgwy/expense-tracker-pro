import { createApp } from "../dist/app.js";
import serverless from "serverless-http";

const app = createApp();

export default serverless(app);