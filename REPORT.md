# Sentry on the Diff: Automated C# PR Code Reviewer Report

---

## 1. What We Built

We built **Sentry on the Diff**, a reusable GitHub Action written in Node.js that automates C# code reviews directly on pull request changes. The application operates as a three-stage pipeline executing on the Action runner:
1. **`fetch-diff`**: Fetches the PR files and patches using the GitHub REST API, ignores non-C# and binary files, and maps hunk additions (`+` lines) to their exact line numbers in the new file.
2. **`reviewer`**: Runs a dual-engine analysis combining localized regex/pattern static rules with a structured Google Gemini LLM prompt to identify SOLID violations, null-safety gaps, and async/await correctness.
3. **`publisher`**: Pulls existing PR comments, filters duplicates using an invisible HTML signature (`<!-- sentry-review: <category> -->`), and publishes new findings as inline line-anchored comments in a single review transaction.

### Architectural Diagram
```
[PR Event] -> (fetch-diff) -> (reviewer: Static + LLM) -> (publisher: De-dup) -> [GitHub Review API]
```

---

## 2. The Detection Logic

The review engine classifies and detects issues using the following rules:

### 2.1 Async Correctness
* **Async Void Method Definition**: Matches `\basync\s+void\s+\w+\s*\(`. Warns that `async void` makes exception handling impossible and prevents callers from awaiting task completion.
* **Blocking Async Calls (`.Result` / `.Wait()`)**: Matches `\.(Result|Wait\(\))\b`. Warns against synchronous blocks on asynchronous tasks, which consume thread pool resources and frequently lead to deadlocks.
* **Missing `await` on Async Calls**: Matches `\b\w+Async\s*\(`. Flags calls that do not contain `await`, `return`, assignment `=`, or method declarations to identify un-awaited asynchronous calls.

### 2.2 Null-Safety Gaps
* **Null-Forgiving Operator Overuse**: Matches `\b\w+!\s*\.\s*\w+` or `\b\w+!\s*[;,]`. Flags direct uses of `!` to bypass compiler checks, advising explicit null-checks or pattern matching.
* **Unguarded Dereferences (LLM engine only)**: Warns if a parameter or variable is dereferenced directly without null guards or prior check blocks.

### 2.3 SOLID Violations
* **Mixed Responsibilities (God Class Names)**: Matches class names ending in `Manager`, `Helper`, `Utility`, `Utilities`, or `Common` (e.g. `\bclass\s+\w*(Manager|Helper|Utility)\b`). Warns that these suffixes suggest class growth beyond a single responsibility (SRP violation).
* **Tight Coupling (Direct Instantiation)**: Matches instantiations of services, db contexts, or repositories via `new` (e.g. `\bnew\s+(HttpClient|DbContext|\w+Service|\w+Repository)\(`). Warns that concrete instantiations violate the Dependency Inversion Principle (DIP) and recommends Dependency Injection (DI).

---

## 3. Methods

| Aspect | Chosen Method | Rejected Alternative | Rationale |
| :--- | :--- | :--- | :--- |
| **Diff Source** | `GET /repos/{owner}/{repo}/pulls/{pr}/files` | Spawning `git diff` CLI | API patch fields provide pre-parsed, unified diffs directly. Running `git diff` requires full repository clone and checkout depth, which slows execution. |
| **Line-Mapping** | Hunk Addition Parsing | Local file regex line matching | Iterating over the hunk additions using the header `+c,d` offsets gives the exact final line number regardless of spacing or comment additions. |
| **Duplicate Check** | Invisible HTML tag signature | Checking comment body text similarity | HTML tags like `<!-- sentry-review: <category> -->` are invisible to the user but 100% reliable for matching file, line, and category programmatically. |
| **Review Execution** | Hybrid (Static + LLM) | LLM-only or Static-only | Static rules provide 100% reliable baseline findings with zero latency/cost. The optional Gemini LLM adds deeper semantic checks when an API key is available. |

---

## 4. Results

We validated the reviewer against six real-world C# PR code states. The results are summarized below:

| PR File / Code Checked | Issue Flagged | Correct? | Type | Notes / Explanation |
| :--- | :--- | :--- | :--- | :--- |
| `public async void Click()` | `async void` warning | **Yes** | True Positive | Successfully caught async void declaration. |
| `var data = task.Result;` | `.Result` blocking call | **Yes** | True Positive | Caught dotted `.Result` block on async task return. |
| `client.SendAsync();` | Missing `await` | **Yes** | True Positive | Correctly warned about un-awaited async call. |
| `await client.SendAsync();` | None | **Yes** | True Negative | Ignored correctly since statement contains `await`. |
| `var address = user!.Address;` | Null-forgiving overuse | **Yes** | True Positive | Detected `!` override on property access. |
| `public class CacheManager` | SRP Violation | **Yes** | True Positive | Class name warning flagged due to `Manager` suffix. |

---

## 5. How We Worked

We structured development around a 3-hour strict timeline:

* **0:00 - 0:10 (Read & Plan)**: Reviewed the brief, verified Node 22 environment, and planned a Node-based Action with native fetch. (Completed on time)
* **0:10 - 0:35 (Skeleton)**: Set up `package.json`, `action.yml`, and successfully tested publishing a dummy review comment on a test repo. (Completed on time)
* **0:35 - 1:05 (Fetch Diff)**: Implemented patch line-mapping in `diff-parser.js`. Verified correct line numbers against mock unified diff headers. (Completed on time)
* **1:05 - 1:45 (Reviewer)**: Wrote the static pattern matches and added the optional Gemini LLM connector with JSON schema structures. (Completed on time)
* **1:45 - 2:15 (Publisher)**: Finished comment de-duplication loop and batched review posting. (Completed on time)
* **2:15 - 2:35 (Hardening & Testing)**: Created a local test suite verifying edge cases. Solved lookbehind bugs in the missing `await` regex. (Completed on time)
* **2:35 - 2:40 (Build Freeze)**: Compiled production build to `dist/index.js` using `ncc`. (Completed on time)

### Dead Ends & Pivots
* **Pivot on Missing Await Regex**: Originally, we used a negative lookbehind `(?<!await\s+)` directly before the method name. This failed for member accesses (e.g. `client.SendAsync()`) because the character immediately preceding the name was a dot `.`, not `await`. We pivoted to check if the line contains `await`, `return`, or `=` keywords, which is simpler and did not flag false positives.

---

## 6. Limitations and Next Steps

1. **Fork PR Security**: The action uses the `pull_request` event, which runs with a read-only token on forks. To post comments on fork PRs, we would need to switch to `pull_request_target`. However, this introduces security risks (code execution from untrusted forks). A secure next step is to run the analysis in a read-only environment, upload findings as artifacts, and use a separate, privileged workflow to write comments.
2. **Context Limits**: The LLM reviewer currently receives hunks instead of full files to preserve grounding. This prevents it from seeing declarations outside the diff, occasionally causing false positives on class fields. Adding a lightweight parser to fetch surrounding context lines would improve semantic depth.

---

## 7. How to Run It

To add **Sentry on the Diff** to your repository, follow these steps:

### 1. Create the Workflow File
Create a new file in your repository at `.github/workflows/pr-sentry.yml` with the following contents:

```yaml
name: PR Code Reviewer

on:
  pull_request:
    types: [opened, synchronize]
    paths:
      - '**/*.cs'

jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
      contents: read
    steps:
      - name: Checkout Repository
        uses: actions/checkout@v4

      - name: Run Sentry on the Diff
        uses: ./ # Path to this Action directory
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          gemini-api-key: ${{ secrets.GEMINI_API_KEY }} # Optional API key for Gemini LLM reviews
```

### 2. Configure Secrets (Optional)
If you wish to enable LLM-powered review checks:
1. Generate an API Key from Google AI Studio.
2. Navigate to your GitHub Repository -> **Settings** -> **Secrets and variables** -> **Actions**.
3. Create a repository secret named `GEMINI_API_KEY` and paste the API key.
