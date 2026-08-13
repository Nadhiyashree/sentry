## Report: Methods and Decisions

## 1. What We Built

Sentry on the Diff is a reusable GitHub Action written in Node.js that automates C# code reviews directly on pull request changes. The application operates as a three-stage pipeline executing on the Action runner.

fetch-diff: Fetches PR files and patches using the GitHub REST API, ignores non-C# and binary files, and maps hunk additions (+ lines) to exact line numbers in the new file.

reviewer: Runs dual-engine analysis combining localized regex/pattern static rules with a structured Google Gemini LLM prompt to identify SOLID violations, null-safety gaps, and async/await correctness.

publisher: Pulls existing PR comments, filters duplicates using an invisible HTML signature such as <!-- sentry-review: category -->, and publishes new findings as inline line-anchored comments in a single review transaction.

```
[PR Event] -> (fetch-diff) -> (reviewer: Static + LLM) -> (publisher: De-dup) -> [GitHub Review API]
```

## 2. Detection Logic

## 2.1 Async Correctness

Async Void Method Definition: Matches \basync\s+void\s+\w+\s*\(. Warns that async void makes exception handling impossible and prevents callers from awaiting task completion.

Blocking Async Calls: Matches \.(Result|Wait\(\))\b. Warns against synchronous blocks on asynchronous tasks because they consume thread-pool resources and can frequently lead to deadlocks.

Missing await: Matches \b\w+Async\s*\(. Flags calls that do not contain await, return, assignment =, or method declarations to identify un-awaited asynchronous calls.

## 2.2 Null-Safety Gaps

Null-Forgiving Operator Overuse: Matches \b\w+!\s*\.\s*\w+ or \b\w+!\s*[;,]. Flags direct uses of ! to bypass compiler checks and advises explicit null-checks or pattern matching.

Unguarded Dereferences: The LLM engine warns if a parameter or variable is dereferenced directly without null guards or prior check blocks.

## 2.3 SOLID Violations

Mixed Responsibilities: Matches class names ending in Manager, Helper, Utility, Utilities, or Common. These suffixes are treated as signals of possible SRP violations.

```
\bclass\s+\w*(Manager|Helper|Utility)\b
```

Tight Coupling: Matches instantiations of services, db contexts, or repositories via new, such as:

```
\bnew\s+(HttpClient|DbContext|\w+Service|\w+Repository)\(
```

The warning identifies possible Dependency Inversion Principle violations and recommends Dependency Injection.

## 3. Methods and Decisions

| Aspect | Chosen Method | Rejected Alternative | Rationale |
| --- | --- | --- | --- |
| Diff Source | GET /repos/{owner}/{repo}/pulls/{pr | Spawning git diff CLI | API patch fields provide pre-parsed |
|   | }/files |   | unified diffs directly; git diff requires |
|   |   |   | a full repository clone and |
|   |   |   | checkout depth. |
| Line-Mapping | Hunk Addition Parsing | Local file regex line matching | Hunk +c,d offsets provide exact |
|   |   |   | final line numbers regardless of |
|   |   |   | spacing or comment additions. |


| Aspect | Chosen Method | Rejected Alternative | Rationale |
| --- | --- | --- | --- |
| Duplicate Check | Invisible HTML tag signature | Comment body text similarity | Invisible tags are reliable for |
|   |   |   | matching file, line, and category |
|   |   |   | programmatically. |
| Review Execution | Hybrid Static + LLM | LLM-only or Static-only | Static rules provide a reliable |
|   |   |   | baseline; optional Gemini adds |
|   |   |   | deeper semantic checks. |

## 4. Key Implementation Pivot

The original missing-await approach used a negative lookbehind (?<!await\s+). It failed for member accesses such as client.SendAsync() because the character immediately preceding SendAsync was a dot rather than await. The approach was changed to inspect the complete line for await, return, assignment, or method-declaration indicators.
