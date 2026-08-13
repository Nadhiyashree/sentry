# Sentry on the Diff: Automated C# PR Reviewer

An automated, noise-free, and grounded C# Pull Request reviewer GitHub Action that detects SOLID violations, null-safety gaps, and async/await correctness directly on PR diff hunks.

---

## 1. What the Project Does
Sentry on the Diff runs on every pull request to review changed C# code. Instead of analyzing full files (which introduces noisy comments on legacy code), it targets **only the lines added or modified** in the PR. It generates line-anchored comments directly in the Pull Request review thread, ensuring developers see actionable quality warnings directly where the code was changed.

---

## 2. Architecture
The Action operates as a modular, three-part pipeline:
```
[PR Event: open/sync] -> [fetch-diff] -> [reviewer: Static + LLM] -> [publisher] -> [GitHub Reviews API]
```
1. **`fetch-diff`**: Retrieves changed files via GitHub REST API, filters out binary, non-C#, and auto-generated files, and parses unified patches.
2. **`reviewer`**: Evaluates mapped hunks against deterministic static rules and optional Google Gemini LLM API reviews.
3. **`publisher`**: Applies the No-Duplicate-Comments rule and packages all findings into a single batch review comment submission using the `COMMENT` event.

---

## 3. Installation & Usage Modes

### Mode A: Running/Testing inside the Sentry Repository
If you are developing or testing the Action internally inside the `sentry` repository itself, you can trigger it locally.

Create `.github/workflows/pr-sentry.yml` inside the Sentry repo:
```yaml
name: PR Code Reviewer (Internal)

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - name: Checkout Repository
        uses: actions/checkout@v4

      - name: Run Sentry on the Diff
        uses: ./ # References the local action in the root of the repo
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          gemini-api-key: ${{ secrets.GEMINI_API_KEY }}
```

### Mode B: Consuming the Published Action from Another C# Repository
To consume this Action from any external C# project repository, configure a workflow file under `.github/workflows/sentry.yml` in your target repository with the following exact configuration:

```yaml
name: Sentry on the Diff

on:
  pull_request:
    types:
      - opened
      - synchronize

permissions:
  contents: read
  pull-requests: write

jobs:
  sentry:
    runs-on: ubuntu-latest

    steps:
      - name: Run Sentry on the Diff
        uses: Nadhiyashree/sentry@main
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          gemini-api-key: ${{ secrets.GEMINI_API_KEY }}
```

---

## 4. Required Secrets
* `GITHUB_TOKEN`: Automatically provided by GitHub Actions (requires `pull-requests: write` and `contents: read` permissions).
* `GEMINI_API_KEY` (Optional): Create an API Key in Google AI Studio to unlock LLM-powered review checks.


---

## 7. Supported Categories
* **`async`**: Catching `async void` signatures, blocking `.Result`/`.Wait()` invocations, and un-awaited asynchronous calls.
* **`null-handling`**: Detecting unguarded dereferences of local variables/parameters assigned from nullable-returning operations, and overused `!` operators.
* **`SOLID`**: Detecting class definitions carrying too many distinct responsibilities (domain method analysis) or tightly coupling concrete dependencies (`new`).

---

## 8. Examples of Findings
### Null Safety
```json
{
  "category": "null-handling",
  "message": "Possible null dereference of 'customer'. Add appropriate null handling before accessing this value."
}
```
### Async Correctness
```json
{
  "category": "async",
  "message": "Avoid blocking asynchronous calls using '.Result' or '.Wait()'. Use 'await' to prevent deadlocks and release thread resources."
}
```
### SOLID Violation
```json
{
  "category": "SOLID",
  "message": "This class 'EmployeeManager' appears to contain multiple unrelated responsibilities (database, calculation, notification). Consider separating these responsibilities into smaller components."
}
```

---

## 9. Testing Instructions
You can execute the automated test suite locally to verify the entire engine:
1. Install development dependencies:
   ```bash
   npm install
   ```
2. Run the test harness:
   ```bash
   node scratch/test-harness.js
   ```

---

## 10. Limitations
* **Fork PR permissions**: Running under standard `pull_request` event has a read-only token on forks. Pushing reviews requires write access, which is disabled on forks by default for safety.
* **Hunk Context Boundaries**: Since we only review diff hunks, declarations outside the hunk boundaries (e.g. fields declared elsewhere in the class) are not visible, which can sometimes limit static flow analysis depth.

---

## 11. How Duplicate Detection Works
To prevent comment spam, before submitting a review, the Action fetches all existing review comments. It generates a stable signature key for each finding:
```text
file_path : line_number : category : normalized_message
```
The message is normalized to lowercase and stripped of all whitespace/punctuation. If an existing comment matches the signature, the duplicate finding is skipped.

---

## 12. How Diff-to-Line Mapping Works
Unified diff hunk headers contain the destination coordinates `+newStart,newLength`. Sentry on the Diff parses these headers to determine where changes start, walks additions (`+`) and context lines sequentially, and increments the new-file line tracker. Deleted lines (`-`) are skipped (no line increment). This maps all findings to the exact target line numbers in the final version of the file.
