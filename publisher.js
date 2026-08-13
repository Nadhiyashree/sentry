const core = require('@actions/core');

/**
 * Publishes review findings as inline comments on the Pull Request.
 * Implements the No-Duplicate-Comments rule.
 * @param {import('@actions/github').getOctokit} octokit 
 * @param {object} context 
 * @param {Array<object>} findings 
 */
async function publishReview(octokit, context, findings) {
  const { owner, repo, number: prNumber } = context.issue;
  
  // Get head commit SHA for anchoring comments correctly
  const commitId = context.payload.pull_request.head.sha;
  core.info(`PR Head Commit SHA: ${commitId}`);

  // 1. Fetch existing review comments on the PR
  core.info(`Fetching existing PR comments...`);
  let existingComments = [];
  try {
    const response = await octokit.rest.pulls.listReviewComments({
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100 // Fetch up to 100 comments (paginate if needed, but 100 is generally plenty)
    });
    existingComments = response.data;
  } catch (error) {
    core.warning(`Failed to fetch existing comments: ${error.message}. Proceeding without de-duplication.`);
  }

  // Create a index of existing bot comments: "file:line:category"
  const existingCommentKeys = new Set();
  for (const comment of existingComments) {
    if (!comment.body) continue;
    const botMatch = comment.body.match(/<!-- sentry-review:\s*([\w-]+)\s*-->/);
    if (botMatch) {
      const category = botMatch[1];
      const key = `${comment.path}:${comment.line}:${category}`;
      existingCommentKeys.add(key);
    }
  }

  // 2. Filter findings that are already posted
  const newFindings = [];
  for (const finding of findings) {
    const key = `${finding.file}:${finding.line}:${finding.category}`;
    if (existingCommentKeys.has(key)) {
      core.info(`Skipping duplicate finding: ${key}`);
      continue;
    }
    newFindings.push(finding);
  }

  if (newFindings.length === 0) {
    core.info("No new findings to post. Skipping review submission.");
    return 0;
  }

  // 3. Format comments for the GitHub Review API
  const reviewComments = newFindings.map(finding => {
    return {
      path: finding.file,
      line: finding.line,
      side: 'RIGHT', // Reviewing the modified (new) version of the code
      body: `<!-- sentry-review: ${finding.category} -->\n**[${finding.category}]** ${finding.message}`
    };
  });

  // 4. Submit review with all comments in one batch
  core.info(`Submitting review with ${reviewComments.length} inline comments...`);
  
  // Group counts for the review body
  const counts = { SOLID: 0, 'null-handling': 0, async: 0 };
  for (const f of newFindings) {
    counts[f.category] = (counts[f.category] || 0) + 1;
  }
  
  const summaryBody = `### 🔍 PR Sentry Code Review Findings
PR Sentry identified **${newFindings.length}** code quality issue(s) in this push:
* **SOLID**: ${counts.SOLID}
* **Null-Safety**: ${counts['null-handling']}
* **Async Correctness**: ${counts.async}

Please see the inline comments below for details.`;

  try {
    const response = await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: prNumber,
      commit_id: commitId,
      event: 'COMMENT', // Always COMMENT, never APPROVE or REQUEST_CHANGES
      body: summaryBody,
      comments: reviewComments
    });

    core.info(`Review successfully posted! Response Status: ${response.status}`);
    
    // Rule: Check response status and fail loudly if review posting failed (non-2xx response)
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Review submission returned status ${response.status}`);
    }
    
    return reviewComments.length;
  } catch (error) {
    core.error(`Failed to submit review comments: ${error.message}`);
    // Rule: The workflow fails loudly (non-zero exit) if the review-posting API call fails
    throw error;
  }
}

module.exports = {
  publishReview
};
