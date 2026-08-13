## Report: Process and Honesty

## 1. Development Process

Development followed a strict three-hour timeline.

| Time | Stage | Work Completed |
| --- | --- | --- |
| 0:00–0:10 | Read & Plan | Reviewed the brief, verified |
|   |   | Node 22 environment, and |
|   |   | planned a Node-based Action |
|   |   | with native fetch. |
| 0:10–0:35 | Skeleton | Set up package.json and |
|   |   | action.yml and tested publishing |
|   |   | a dummy review comment. |
| 0:35–1:05 | Fetch Diff | Implemented patch line-mapping |
|   |   | in diff-parser.js and verified line |
|   |   | numbers against mock unified |
|   |   | diff headers. |
| 1:05–1:45 | Reviewer | Wrote static pattern matches |
|   |   | and added the optional Gemini |
|   |   | LLM connector with JSON |
|   |   | schema structures. |
| 1:45–2:15 | Publisher | Finished comment |
|   |   | de-duplication and batched |
|   |   | review posting. |
| 2:15–2:35 | Hardening & Testing | Created local edge-case tests |
|   |   | and solved lookbehind bugs in |
|   |   | the missing-await regex. |
| 2:35–2:40 | Build Freeze | Compiled production build to |
|   |   | dist/index.js using ncc. |

## 2. Dead Ends & Pivots

The original negative-lookbehind missing-await regex failed for member accesses such as client.SendAsync(). Testing exposed the issue, so the logic was changed to inspect the complete line for await, return, assignment, or method declarations.

## 3. Process and Honesty

The implementation was tested and revised rather than presenting the first approach as universally correct. The six validation cases all passed, but the evidence supports only the statement that the reviewer achieved 6/6 correct classifications on those selected cases.

Several rules are heuristic. For example, a class named CacheManager is not automatically an SRP violation; the naming pattern is a signal for possible design problems.

## 4. Limitations and Next Steps

## 4.1 Fork PR Security

The action uses the pull_request event, which runs with a read-only token on forks. Switching to pull_request_target could enable comment publishing, but it introduces security risks if untrusted fork code executes with privileged permissions.

A safer next step is to run analysis in a read-only environment, upload findings as artifacts, and use a separate privileged workflow to write comments.

## 4.2 Context Limits


The LLM reviewer currently receives hunks instead of full files to preserve grounding. This can prevent it from seeing declarations outside the diff and occasionally cause false positives involving class fields. A lightweight parser that fetches surrounding context lines would improve semantic depth.

## 5. How to Run It

## 5.1 Workflow File

Create .github/workflows/pr-sentry.yml with:

name: PR Code Reviewer on: pull_request: types: [opened, synchronize] paths: - '**/*.cs' jobs: review: runs-on: ubuntu-latest permissions: pull-requests: write contents: read steps: - name: Checkout Repository uses: actions/checkout@v4 - name: Run Sentry on the Diff uses: ./ # Path to this Action directory with: github-token: \${{ secrets.GITHUB_TOKEN }} gemini-api-key: \${{ secrets.GEMINI_API_KEY }} # Optional

## 5.2 Gemini API Key

To enable LLM-powered checks: generate an API key from Google AI Studio; go to GitHub Repository Settings Secrets and variables Actions; create a repository secret named GEMINI_API_KEY; and paste the API key into the secret.
