const core = require('@actions/core');

/**
 * Retrieves the changed files and parses their unified diffs to map line numbers.
 * @param {import('@actions/github').getOctokit} octokit 
 * @param {object} context 
 * @returns {Promise<Array<object>>} Mapped file diffs
 */
async function fetchDiff(octokit, context) {
  const { owner, repo, number: prNumber } = context.issue;
  
  core.info(`Fetching changed files for PR #${prNumber} in ${owner}/${repo}...`);
  
  const { data: files } = await octokit.rest.pulls.listFiles({
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100 // Adjust if PRs are exceptionally large, but typical limit is fine
  });

  const parsedDiffs = [];

  for (const file of files) {
    const filename = file.filename;
    
    // Rule: Skip deleted files
    if (file.status === 'removed') {
      core.info(`Skipping deleted file: ${filename}`);
      continue;
    }

    // Rule: Non-C# and unparseable/binary files are skipped
    if (!filename.toLowerCase().endsWith('.cs')) {
      core.info(`Skipping non-C# file: ${filename}`);
      continue;
    }

    // Rule: Check if patch is missing (truncated by GitHub for large files)
    if (!file.patch) {
      core.info(`Skipping file due to missing or truncated patch: ${filename}`);
      continue;
    }

    core.info(`Parsing diff patch for C# file: ${filename}`);
    const hunks = parsePatch(file.patch);
    
    if (hunks.length > 0) {
      parsedDiffs.push({
        file: filename,
        sha: file.sha,
        hunks
      });
    }
  }

  return parsedDiffs;
}

/**
 * Parses a unified diff patch string into structured hunks with mapped line numbers.
 * @param {string} patch 
 * @returns {Array<object>} Parsed hunks
 */
function parsePatch(patch) {
  const lines = patch.split('\n');
  const hunks = [];
  let currentHunk = null;
  let currentNewLine = 0;

  for (const line of lines) {
    const hunkHeaderMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/);
    
    if (hunkHeaderMatch) {
      if (currentHunk) {
        hunks.push(currentHunk);
      }
      
      const newStartLine = parseInt(hunkHeaderMatch[1], 10);
      currentNewLine = newStartLine;
      
      currentHunk = {
        header: line,
        additions: [],
        lines: [] // Store all lines in the hunk for context
      };
      continue;
    }

    if (currentHunk) {
      currentHunk.lines.push(line);
      
      if (line.startsWith('+')) {
        // Line added: maps to currentNewLine in the new file
        currentHunk.additions.push({
          lineNum: currentNewLine,
          content: line.slice(1)
        });
        currentNewLine++;
      } else if (line.startsWith('-')) {
        // Line deleted: doesn't exist in the new file, so we do not increment new line counter
        // (no line mapping needed as we can't comment on deleted lines in the new file)
      } else {
        // Context line: exists in the new file, increment new line counter
        currentNewLine++;
      }
    }
  }

  if (currentHunk) {
    hunks.push(currentHunk);
  }

  return hunks;
}

module.exports = {
  fetchDiff,
  parsePatch
};
