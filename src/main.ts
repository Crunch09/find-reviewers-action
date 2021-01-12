import * as core from "@actions/core";
import * as github from "@actions/github";
import { ReviewAssigner } from "./ReviewAssigner";
import * as Webhooks from "@octokit/webhooks";
import { promises as fs } from "fs";
import YAML from "yaml";

async function run(): Promise<void> {
  try {
    const token = core.getInput("token", { required: true });
    const type = core.getInput("type", { required: true });
    const reviewers: ReviewAssigner = new ReviewAssigner();
    const payload = github.context
      .payload as Webhooks.Webhooks.WebhookPayloadPullRequest;

    const config = await fs.readFile(".github/find_reviewers.yml", "utf8");
    switch (type) {
      case "pull_request":
        await reviewers.assignReviewers(token, payload, YAML.parse(config));
        break;
      case "issue_comment":
        await reviewers.updateReviewers(token, payload, YAML.parse(config));
    }

  } catch (error) {
    core.error(error);
    core.setFailed(error.message);
  }
}

run();
