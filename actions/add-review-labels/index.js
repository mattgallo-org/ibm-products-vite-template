/**
 * Copyright IBM Corp. 2020, 2024
 *
 * This source code is licensed under the Apache-2.0 license found in the
 * LICENSE file in the root directory of this source tree.
 */

'use strict';

import github from '@actions/github';
import core from '@actions/core';
import { App } from "octokit";

async function run() {
  const { context, event } = github;
  console.log(context, event);
  const appId = core.getInput('APP_ID', {
    required: true,
  });
  const privateKey = core.getInput('APP_PRIVATE_KEY', {
    required: true,
  });
  const app = new App({ appId, privateKey, });
  const octokit = await app.getInstallationOctokit(52238220);

  const { pull_request: pullRequest, repository, review, action } = context.payload;
  const { state, draft } = pullRequest;

  // We only want to work with Pull Requests that are marked as open
  if (state !== 'open') {
    return;
  }

  // We only want to work with Pull Requests that are not draft PRs
  if (draft) {
    return;
  }

  // If the review was not an approval then we'll ignore the event
  if (review && review.state !== 'approved') {
    return;
  }

  const { data: allReviews } = await octokit.rest.pulls.listReviews({
    owner: repository.owner.login,
    repo: repository.name,
    pull_number: pullRequest.number,
    per_page: 100,
  });

  // Get reviewer team data
  const { data } = await octokit.request('GET /orgs/{org}/teams/{team_slug}', {
    org: 'mattgallo-org',
    team_slug: 'reviewing-team',
    headers: {
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });
  const { members_url } = data;
  console.log(data, members_url);

  const org_id = members_url.split('organizations/').pop().split('/team')[0];
  const team_id = members_url.split('team/').pop().split('/members')[0];
  console.log({org_id, team_id});
  const {data: teamMembers} = await octokit.request('GET /organizations/{org_id}/team/{team_id}/members', {
    org_id,
    team_id,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    }
  });

  console.log(teamMembers);

  const additionalReviewLabel = 'status: one more review 👀';
  const readyForReviewLabel = 'status: ready for review 👀';

  // If we find that the reviewing user is not part of the reviewing team
  // then we don't want to count their review so we stop here
  const reviewingUser = review.user.login;
  if (!teamMembers.filter(user => user.login === reviewingUser).length) {
    return;
  }

  // The `listReviews` endpoint will return all of the reviews for the pull
  // request. We only care about the most recent reviews so we'll go through the
  // list and get the most recent review for each reviewer
  const reviewers = {};
  const reviews = [];

  // Process reviews in reverse order since they are listed from oldest to newest
  for (const review of allReviews.reverse()) {
    const { user } = review;
    // If we've already saved a review for this user we already have the most
    // recent review
    if (reviewers[user.login]) {
      continue;
    }

    // If the author of the review not part of the reviewer team we ignore it
    if (!teamMembers.filter(u => u.login === user.login).length) {
      continue;
    }

    reviewers[user.login] = true;
    reviews.push(review);
  }

  console.log('////////////////////////////////////////////');
  console.log(reviewers);
  console.log('////////////////////////////////////////////');
  console.log(reviews);
  console.log('////////////////////////////////////////////');

  const approved = reviews.filter((review) => {
    return review.state === 'APPROVED';
  });

  if (approved.length > 0) {
    const hasReadyLabel = pullRequest.labels.find((label) => {
      return label.name === readyForReviewLabel;
    });
    // Remove ready for review label if there is at least one approval
    if (hasReadyLabel) {
      await octokit.rest.issues.removeLabel({
        owner: repository.owner.login,
        repo: repository.name,
        issue_number: pullRequest.number,
        name: readyForReviewLabel,
      });
    }
  }

  if (approved.length === 1) {
    const hasAdditionalReviewLabel = pullRequest.labels.find((label) => {
      return label.name === additionalReviewLabel;
    });
    // Add the one more review label if there's at least one approval and it doesn't have the label already
    if (!hasAdditionalReviewLabel) {
      await octokit.rest.issues.addLabels({
        owner: repository.owner.login,
        repo: repository.name,
        issue_number: pullRequest.number,
        labels: [additionalReviewLabel],
      });
    }
    return;
  }

  if (approved.length >= 2) {
    const hasAdditionalReviewLabel = pullRequest.labels.find((label) => {
      return label.name === additionalReviewLabel;
    });
    // Remove the one mor review label if there are at least 2 approvals
    if (hasAdditionalReviewLabel) {
      await octokit.rest.issues.removeLabel({
        owner: repository.owner.login,
        repo: repository.name,
        issue_number: pullRequest.number,
        name: additionalReviewLabel,
      });
    }
    return;
  }
}

run().catch((error) => {
  console.log(error);
  process.exit(1);
});
