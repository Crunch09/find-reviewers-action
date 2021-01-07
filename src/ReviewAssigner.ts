import * as core from '@actions/core';
import * as github from '@actions/github';
import { promises as fs } from 'fs';
import YAML from 'yaml';
import * as Webhooks from '@octokit/webhooks';
import { WebClient, WebAPICallResult } from '@slack/web-api';


export interface ExistingReviewers {
    users: {
        login: string;
        id: number;
        node_id: string;
        avatar_url: string;
        gravatar_id: string;
        url: string;
        html_url: string;
        followers_url: string;
        following_url: string;
        gists_url: string;
        starred_url: string;
        subscriptions_url: string;
        organizations_url: string;
        repos_url: string;
        events_url: string;
        received_events_url: string;
        type: string;
        site_admin: boolean;
    }[];
    teams: {
        id: number;
        node_id: string;
        url: string;
        html_url: string;
        name: string;
        slug: string;
        description: string;
        privacy: string;
        permission: string;
        members_url: string;
        repositories_url: string;
        parent: string;
    }[];
}

export interface PullRequest {
    url: string;
    id: number;
    node_id: string;
    html_url: string;
    diff_url: string;
    patch_url: string;
    issue_url: string;
    number: number;
    state: string;
    locked: boolean;
    title: string;
    body: string;
    created_at: string;
    updated_at: string;
    closed_at: null | string;
    merged_at: null;
    merge_commit_sha: null | string;
    requested_reviewers: Array<any>;
    requested_teams: Array<any>;
    commits_url: string;
    review_comments_url: string;
    review_comment_url: string;
    comments_url: string;
    statuses_url: string;
    author_association: string;
    draft: boolean;
    merged: boolean;
    mergeable: null | boolean;
    rebaseable: null | boolean;
    mergeable_state: string;
    merged_by: null;
    comments: number;
    review_comments: number;
    maintainer_can_modify: boolean;
    commits: number;
    additions: number;
    deletions: number;
    changed_files: number;
  };

export interface AssignedReviewer {
    login: string;
    id: number;
    type: string;
}

export class ReviewAssigner {
    constructor() {

    }

    async assignReviewers(token: string, payload: Webhooks.Webhooks.WebhookPayloadPullRequest): Promise<void> {
        const attachedLabel = payload.label?.name;
        const content = await fs.readFile(".github/reviewers.yml", "utf8");

        const config = YAML.parse(content)
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
                                const ix = group.possible_reviewers.indexOf(payload.pull_request.user.login);
                                if (ix > -1) {
                                    group.possible_reviewers.splice(ix, 1);
                                }

                                // Remove existing reviewers
                                for (const i in currentReviewers.users) {
                                    if (currentReviewers.users.hasOwnProperty(i)) {
                                        const ix = group.possible_reviewers.indexOf(currentReviewers.users[i].login)
                                        if (ix > -1) {
                                            group.possible_reviewers.splice(ix, 1);
                                        }
                                    }
                                }

                                // Remove already picked reviewers
                                for (const i in pickedReviewers) {
                                    if (pickedReviewers.hasOwnProperty(i)) {
                                        const ix = group.possible_reviewers.indexOf(pickedReviewers[i])
                                        if (ix > -1) {
                                            group.possible_reviewers.splice(ix, 1);
                                        }
                                    }
                                }

                                //  Pick reviewers
                                for (let i = 0; i < numberOfPicks && group.possible_reviewers.length > 0; i++) {
                                    const pickedReviewer = group.possible_reviewers[Math.floor(Math.random() * group.possible_reviewers.length)];
                                    const ix = group.possible_reviewers.indexOf(pickedReviewer);
                                    group.possible_reviewers.splice(ix, 1);

                                    pickedReviewers.push(pickedReviewer);
                                }
                            }
                        }
                    }

                    await this.updateReviewers(token, pickedReviewers, currentReviewers, config);
                    await this.sendSlackMessage(pickedReviewers, config, payload);
                }
            }
        }

    }

    private async getRequestedReviewers(token: string): Promise<ExistingReviewers> {
        try {
            const octo = github.getOctokit(token);

            const reviewersResult = await octo.pulls.listRequestedReviewers({
                owner: github.context.repo.owner,
                repo: github.context.repo.repo,
                pull_number: github.context.issue.number
            });
            return reviewersResult.data;
        } catch (error) {
            core.setFailed(`Get requested reviewers error: ${error.message}`);
            return Promise.resolve({users: [], teams: []});
        }
    }

    private async updateReviewers(token: string, pickedReviewers: string[], existingReviewers: ExistingReviewers, config: any): Promise<void> {
        try {
            const octo = github.getOctokit(token);

            await octo.pulls.requestReviewers({
                owner: github.context.repo.owner,
                repo: github.context.repo.repo,
                pull_number: github.context.issue.number,
                reviewers: [...pickedReviewers, ...existingReviewers.users.map(x => x.login.toLowerCase())].filter(x => x),
                team_reviewers: existingReviewers.teams.map(x => x.slug),
            });
        } catch (error) {
            core.setFailed(`Couldn't assign reviewers: ${error.message}`);
        }
    }

    private async sendSlackMessage(pickedReviewers: string[], config: any, payload: Webhooks.Webhooks.WebhookPayloadPullRequest) {
      try {
        const slackConfig = config.notifications?.slack;
        if (slackConfig) {
          const { IncomingWebhook } = require('@slack/webhook');
          const webhook = new IncomingWebhook(slackConfig.url);
          const modifications = `${payload.commits} commits, +${payload.additions} -${payload.deletions}`;
          const pickedReviewers = pickedReviewers.map(username => `<https://github.com/${username}|${username}>`).join(', ');
          if (userNotifications !== '') {
            userNotifications = `for ${userNotifications}`;
          }
          const userNotifications = getMappedReviewers(pickedReviewers, config).join(', ');
          await webhook.send({
            channel: config.channel,
            username: 'find-reviewers',
            text: `Review requested: <${payload.html_url}|${payload.base.repo.full_name}#${payload.number} by ${payload.user.login}> ${userNotifications}`.trim(),
            attachments: [
              {
                pretext: payload.title,
                fallback: `${pickedReviewers}. ${modifications}`,
                color: 'good',
                fields: [
                  {
                    title: 'Requested reviewers',
                    value: pickedReviewers,
                    short: true
                  },
                  {
                    title: 'Changes',
                    value: modifications,
                    short: true
                  }
                ]
              }
            ]
          });
        }

      } catch (error) {
          core.setFailed(`Couldn't send slack message: ${error.message}`);
      }
    }

    private getMappedReviewers(pickedReviewers: string[], config: any) {
      let mappedReviewers: string[] = [];
      const userMappings = config.user_mappings;
      for (const username in pickedReviewers) {
        const mapping = userMappings[username];
        if (mapping && mapping.hasOwnProperty('slack')) {
          mappedReviewers.push(mapping.slack);
        }
      }
    }

}
