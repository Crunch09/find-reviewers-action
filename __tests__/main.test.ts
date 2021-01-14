import * as core from "@actions/core";
import * as github from "@actions/github";
import { Octokit } from "@octokit/rest";

import { ReviewAssigner } from "../src/ReviewAssigner";

test("it works", async () => {
  const group_one = {
    number_of_picks: 2,
    possible_reviewers: ["foo", "bar", "baz"],
  };
  const group_two = {
    number_of_picks: 1,
    possible_reviewers: ["luke", "obi-wan", "yoda", "darth"],
  };
  const exampleConfig = {
    labels: [
      {
        groups: [group_one, group_two],
        label: "read-for-review",
      },
    ],
  };

  const labeledEvent = {
    action: "labeled",
    number: 123,
    pull_request: {
      title: "Sample PR",
      user: {
        login: "bb8",
      },
      html_url: "https://github.com/example/example/pulls/1",
      commits: 1,
      additions: 10,
      deletions: 5,
    },
    repository: {
      full_name: "example/example",
    },
    label: {
      name: "read-for-review",
    },
  };

  const reviewers = new ReviewAssigner(true);
  let chosen_reviewers = await reviewers.assignReviewers(
    "123",
    labeledEvent,
    JSON.parse(JSON.stringify(exampleConfig))
  );
  let matches_group_one = chosen_reviewers.filter((reviewer) =>
    group_one.possible_reviewers.includes(reviewer)
  );
  let matches_group_two = chosen_reviewers.filter((reviewer) =>
    group_two.possible_reviewers.includes(reviewer)
  );
  expect(matches_group_one.length).toEqual(group_one.number_of_picks);
  expect(matches_group_two.length).toEqual(group_two.number_of_picks);
});
