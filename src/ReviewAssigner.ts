import * as core from "@actions/core";
import * as github from "@actions/github";
import * as slack from "@slack/webhook";

export interface ExistingReviewers {
  users: User[];
  teams: {
    slug: string;
  }[];
}

export interface User {
  login: string;
}

export interface PullRequest {
  title: string;
  user: User;
  commits: number;
  additions: number;
  deletions: number;
  html_url: string;
}

export interface Repository {
  full_name: string;
}

export interface Label {
  name: string;
}

export interface PullRequestLabeled {
  action: string;
  number: number;
  pull_request: PullRequest;
  repository: Repository;
  label?: Label;
}

export interface PullRequestCommented {
  action: string;
  issue: Issue;
  repository: Repository;
  label?: Label;
  comment: Comment;
}

export interface Comment {
  body: string;
}

export interface Issue {
  labels: Label[];
  user: User;
}

export interface AssignedReviewer {
  login: string;
  id: number;
  type: string;
}

export class ReviewAssigner {
  readonly debugOnly: boolean;

  constructor(debugOnly: boolean) {
    this.debugOnly = debugOnly;
  }

  async assignReviewers(
    token: string,
    payload: PullRequestLabeled,
    config: any
  ): Promise<string[]> {
    const attachedLabel = payload.label?.name;

    for (const i in config.labels) {
      if (config.labels.hasOwnProperty(i)) {
        const label = config.labels[i];
        if (label.label == attachedLabel) {
          const currentReviewers = await this.getRequestedReviewers(token);
          let pickedReviewers: string[] = [];
          // loop through all assignment groups
          for (const i in label.groups) {
            if (label.groups.hasOwnProperty(i)) {
              const group = label.groups[i];
              if (group.possible_reviewers && group.number_of_picks) {
                const numberOfPicks = group.number_of_picks;
                // remove PR owner
                const ix = group.possible_reviewers.indexOf(
                  payload.pull_request.user.login
                );
                if (ix > -1) {
                  group.possible_reviewers.splice(ix, 1);
                }

                // Remove existing reviewers
                for (const i in currentReviewers.users) {
                  if (currentReviewers.users.hasOwnProperty(i)) {
                    const ix = group.possible_reviewers.indexOf(
                      currentReviewers.users[i].login
                    );
                    if (ix > -1) {
                      group.possible_reviewers.splice(ix, 1);
                    }
                  }
                }

                // Remove already picked reviewers
                for (const i in pickedReviewers) {
                  if (pickedReviewers.hasOwnProperty(i)) {
                    const ix = group.possible_reviewers.indexOf(
                      pickedReviewers[i]
                    );
                    if (ix > -1) {
                      group.possible_reviewers.splice(ix, 1);
                    }
                  }
                }

                //  Pick reviewers
                for (
                  let i = 0;
                  i < numberOfPicks && group.possible_reviewers.length > 0;
                  i++
                ) {
                  const pickedReviewer =
                    group.possible_reviewers[
                      Math.floor(
                        Math.random() * group.possible_reviewers.length
                      )
                    ];
                  const ix = group.possible_reviewers.indexOf(pickedReviewer);
                  group.possible_reviewers.splice(ix, 1);

                  pickedReviewers.push(pickedReviewer);
                }
              }
            }
          }

          if (pickedReviewers.length > 0) {
            await this.updateReviewers(
              token,
              pickedReviewers,
              [],
              currentReviewers,
              config
            );
            await this.sendSlackMessage(pickedReviewers, config, payload);
          }
          return Promise.resolve(pickedReviewers);
        }
      }
    }
    return Promise.resolve([]);
  }

  async reassignReviewer(
    token: string,
    payload: PullRequestCommented,
    config: any
  ): Promise<void> {
    const commentRegex = /^\/reviewers unassign @(\S+)/gi;
    const body = payload.comment.body;
    const unassignment = commentRegex.exec(body);

    if (unassignment !== null) {
      const unassignedPerson = unassignment[1].toLowerCase();
      const currentReviewers = await this.getRequestedReviewers(token);
      const mappedCurrentReviewers = currentReviewers.users
        .map((x) => x.login.toLowerCase())
        .filter((x) => x);

      if (mappedCurrentReviewers.includes(unassignedPerson)) {
        let replacementReviewer = await this.getPossibleReviewer(
          payload,
          config,
          [unassignedPerson.toLowerCase(), ...mappedCurrentReviewers].filter(
            (x) => x
          ),
          unassignedPerson.toLowerCase()
        );
        if (replacementReviewer) {
          await this.removeReviewer(token, [unassignment[1]], config);
          await this.updateReviewers(
            token,
            [replacementReviewer],
            [unassignment[1]],
            currentReviewers,
            config
          );
        }
      }
    }
  }

  private async getRequestedReviewers(
    token: string
  ): Promise<ExistingReviewers> {
    if (this.debugOnly) {
      return Promise.resolve({ users: [], teams: [] });
    }
    try {
      const octo = github.getOctokit(token);

      const reviewersResult = await octo.pulls.listRequestedReviewers({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        pull_number: github.context.issue.number,
      });
      return reviewersResult.data;
    } catch (error) {
      core.setFailed(`Get requested reviewers error: ${error.message}`);
      return Promise.resolve({ users: [], teams: [] });
    }
  }

  private async getPossibleReviewer(
    payload: PullRequestCommented,
    config: any,
    reviewersToExclude: string[],
    unassignedPerson: string
  ) {
    const currentLabels = payload.issue.labels.map((x) => x.name);

    const uniqueReviewersToExclude = [...new Set(reviewersToExclude)];

    const owner = payload.issue.user.login.toLowerCase();
    reviewersToExclude = [owner, ...uniqueReviewersToExclude].filter((x) => x);

    for (let i in config.labels) {
      if (currentLabels.includes(config.labels[i].label)) {
        for (let g in config.labels[i].groups) {
          let specificConfig = config.labels[i].groups[g];
          let possibleReviewers = specificConfig.possible_reviewers;
          if (
            possibleReviewers &&
            possibleReviewers.includes(unassignedPerson) &&
            specificConfig.number_of_picks
          ) {
            for (let i = 0; i < reviewersToExclude.length; i++) {
              let index = possibleReviewers.indexOf(reviewersToExclude[i]);
              if (index > -1) {
                possibleReviewers.splice(index, 1);
              }
            }
            if (possibleReviewers.length > 0) {
              return possibleReviewers[
                Math.floor(Math.random() * possibleReviewers.length)
              ];
            }
          }
        }
      }
    }
    return null;
  }

  private async removeReviewer(
    token: string,
    reviewers: string[],
    config: any
  ): Promise<void> {
    try {
      const octo = github.getOctokit(token);

      await octo.pulls.removeRequestedReviewers({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        pull_number: github.context.issue.number,
        reviewers: reviewers,
        team_reviewers: reviewers,
      });
    } catch (error) {
      core.setFailed(`Couldn't remove reviewer: ${error.message}`);
    }
  }

  private async updateReviewers(
    token: string,
    pickedReviewers: string[],
    excludedReviewers: string[],
    existingReviewers: ExistingReviewers,
    config: any
  ): Promise<void> {
    if (this.debugOnly) {
      return;
    }
    try {
      const octo = github.getOctokit(token);

      await octo.pulls.requestReviewers({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        pull_number: github.context.issue.number,
        reviewers: [
          ...pickedReviewers,
          ...existingReviewers.users.map((x) => x.login.toLowerCase()),
        ].filter((x) => x && !excludedReviewers.includes(x)),
        team_reviewers: existingReviewers.teams.map((x) => x.slug),
      });
    } catch (error) {
      core.setFailed(`Couldn't assign reviewers: ${error.message}`);
    }
  }

  private async sendSlackMessage(
    pickedReviewers: string[],
    config: any,
    payload: PullRequestLabeled
  ) {
    if (this.debugOnly) {
      return;
    }
    try {
      const slackConfig = config.notifications?.slack;
      if (slackConfig) {
        const webhook = new slack.IncomingWebhook(slackConfig.url);
        const modifications = `${payload.pull_request.commits} commits, +${payload.pull_request.additions} -${payload.pull_request.deletions}`;
        const pickedReviewerNames = pickedReviewers
          .map((username) => `<https://github.com/${username}|${username}>`)
          .join(", ");
        let userNotifications = this.getMappedReviewers(
          pickedReviewers,
          config
        ).join(", ");
        if (userNotifications !== "") {
          userNotifications = `for ${userNotifications}`;
        }

        await webhook.send({
          channel: config.notifications?.slack?.channel,
          username: "find-reviewers",
          text: `Review requested: <${payload.pull_request.html_url}|${payload.repository.full_name}#${payload.number} by ${payload.pull_request.user.login}> ${userNotifications}`.trim(),
          attachments: [
            {
              pretext: payload.pull_request.title,
              fallback: `${pickedReviewerNames}. ${modifications}`,
              color: "good",
              fields: [
                {
                  title: "Requested reviewers",
                  value: pickedReviewerNames,
                  short: true,
                },
                {
                  title: "Changes",
                  value: modifications,
                  short: true,
                },
              ],
            },
          ],
        });
      }
    } catch (error) {
      core.setFailed(`Couldn't send slack message: ${error.message}`);
    }
  }

  private getMappedReviewers(pickedReviewers: string[], config: any) {
    let mappedReviewers: string[] = [];
    const userMappings = config.user_mappings;
    console.log(pickedReviewers);
    pickedReviewers.forEach((username) => {
      const mapping = userMappings[username];
      if (mapping && mapping.hasOwnProperty("slack")) {
        mappedReviewers.push(`<@${mapping.slack}>`);
      }
    });
    return mappedReviewers;
  }
}
