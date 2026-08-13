const core = require('@actions/core');
const github = require('@actions/github');
const { fetchDiff } = require('./diff-parser');
const { reviewDiffs } = require('./reviewer');
const { publishReview } = require('./publisher');

async function run() {
  try {
    core.info("Starting PR Sentry review workflow...");

    // 1. Gather Action inputs
    const token = core.getInput('github-token', { required: true });
    const geminiApiKey = core.getInput('gemini-api-key') || null;

    // 2. Validate trigger context
    const context = github.context;
    if (!context.payload.pull_request) {
      core.setFailed("This action only supports pull_request events.");
      return;
    }

    const octokit = github.getOctokit(token);

    // 3. Fetch changed C# files and line mapping
    const fileDiffs = await fetchDiff(octokit, context);
    
    if (fileDiffs.length === 0) {
      core.info("No changed C# files found in this pull request. Exiting cleanly.");
      core.setOutput('findings-count', 0);
      return;
    }

    // 4. Review the hunks (Static rules + LLM if API key provided)
    const findings = await reviewDiffs(fileDiffs, geminiApiKey);
    core.info(`Total findings identified by reviewer: ${findings.length}`);

    // 5. De-duplicate and publish the comments
    const postedCommentsCount = await publishReview(octokit, context, findings);
    
    core.setOutput('findings-count', postedCommentsCount);
    core.info(`PR Sentry review workflow completed. Posted ${postedCommentsCount} new comment(s).`);

  } catch (error) {
    core.error(`Error executing action: ${error.stack}`);
    core.setFailed(`Action execution failed: ${error.message}`);
  }
}

run();
