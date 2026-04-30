// Side-effect-only module: load `.env` into `process.env` before any module
// that reads env vars at evaluation time. ES module imports run top-down in
// source order, so importing this first guarantees `dotenv.config()` finishes
// before later imports' top-level code (e.g. `createMcp()`) executes.
import * as dotenv from "dotenv";

dotenv.config();
