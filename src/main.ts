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

    const config = await fs.readFile(".github/find_reviewers.yml", "utf8");
    switch (type) {
      case "pull_request":
        const prPayload = github.context
          .payload as Webhooks.Webhooks.WebhookPayloadPullRequest;
        await reviewers.assignReviewers(token, prPayload, YAML.parse(config));
        break;
      case "issue_comment":
        const commentPayload = github.context
          .payload as Webhooks.Webhooks.WebhookPayloadIssueComment;
        await reviewers.reassignReviewer(token, commentPayload, YAML.parse(config));
        break;
    }

  } catch (error) {
    core.error(error);
    core.setFailed(error.message);
  }
}

run();
