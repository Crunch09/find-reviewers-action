import * as core from "@actions/core";
import * as github from "@actions/github";

async function run(): Promise<void> {
  const nameToGreet = "Foobar";
  console.log(`Hello ${nameToGreet}`);
  const time = new Date().toTimeString();
  core.setOutput("time", time);

  const payload = JSON.stringify(github.context.payload, undefined, 2);
  console.log(`The event payload: ${payload}`);
}

run();
