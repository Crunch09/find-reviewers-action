import * as core from "@actions/core";
import * as github from "@actions/github";
import { ReviewAssigner } from "./ReviewAssigner";
import * as Webhooks from "@octokit/webhooks";

async function run(): Promise<void> {
  try {
    const token = core.getInput("token", { required: true });
    const reviewers: ReviewAssigner = new ReviewAssigner();
    const payload = github.context
      .payload as Webhooks.Webhooks.WebhookPayloadPullRequest;
    await reviewers.assignReviewers(token, payload);
  } catch (error) {
    core.error(error);
    core.setFailed(error.message);
  }
}

run();
