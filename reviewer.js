const core = require('@actions/core');

/**
 * Reviews all files and hunks, combining static and LLM findings if available.
 * @param {Array<object>} fileDiffs 
 * @param {string|null} geminiApiKey 
 * @returns {Promise<Array<object>>} Unified findings array
 */
async function reviewDiffs(fileDiffs, geminiApiKey) {
  let allFindings = [];

  for (const fileDiff of fileDiffs) {
    const file = fileDiff.file;
    core.info(`Reviewing file: ${file}`);

    for (const hunk of fileDiff.hunks) {
      const validLines = new Set(hunk.additions.map(a => a.lineNum));
      
      // 1. Run local static rule-based reviewer
      const staticFindings = reviewHunkStatic(file, hunk, validLines);
      allFindings.push(...staticFindings);

      // 2. Run LLM reviewer if API key is provided
      if (geminiApiKey) {
        try {
          const llmFindings = await reviewHunkLLM(file, hunk, validLines, geminiApiKey);
          
          // Merge LLM findings, avoiding duplicates with static findings
          for (const llmF of llmFindings) {
            const isDuplicate = staticFindings.some(sf => 
              sf.line === llmF.line && 
              sf.category === llmF.category
            );
            if (!isDuplicate) {
              allFindings.push(llmF);
            }
          }
        } catch (error) {
          core.warning(`LLM review failed for hunk in ${file}: ${error.message}. Falling back to static findings.`);
        }
      }
    }
  }

  return allFindings;
}

/**
 * Static rule-based reviewer using regex and pattern analysis.
 * @param {string} file 
 * @param {object} hunk 
 * @param {Set<number>} validLines 
 * @returns {Array<object>} Static findings
 */
function reviewHunkStatic(file, hunk, validLines) {
  const findings = [];

  for (const addition of hunk.additions) {
    const { lineNum, content } = addition;
    const trimmedContent = content.trim();

    // Skip comments or empty lines
    if (trimmedContent.startsWith('//') || trimmedContent.startsWith('/*') || trimmedContent === '') {
      continue;
    }

    // --- ASYNC CORRECTNESS RULES ---

    // Async void check
    // e.g. "public async void MyMethod("
    if (/\basync\s+void\s+\w+\s*\(/.test(trimmedContent)) {
      findings.push({
        file,
        line: lineNum,
        category: 'async',
        severity: 'warning',
        message: "Avoid using 'async void'. Use 'async Task' instead so that exceptions can be caught and the caller can await the execution.",
        hunk_ref: hunk.header
      });
    }

    // Blocking async calls using .Result or .Wait()
    // e.g. "task.Result" or "task.Wait()"
    if (/\.(Result|Wait\(\))\b/.test(trimmedContent)) {
      findings.push({
        file,
        line: lineNum,
        category: 'async',
        severity: 'warning',
        message: "Avoid blocking asynchronous calls using '.Result' or '.Wait()'. Use 'await' to prevent deadlocks and release thread resources.",
        hunk_ref: hunk.header
      });
    }

    // Missing await on async method calls
    // e.g. "DoSomethingAsync();" without await, return, or assignment
    if (/\b\w+Async\s*\(/.test(trimmedContent)) {
      const isAwaited = /\bawait\b/.test(trimmedContent);
      const isReturned = /\breturn\b/.test(trimmedContent);
      const isAssigned = trimmedContent.includes('=');
      const isDefinition = /\b(class|interface|void|Task|ValueTask|async)\b/.test(trimmedContent);

      if (!isAwaited && !isReturned && !isAssigned && !isDefinition && !/\.(Result|Wait\(\))\b/.test(trimmedContent)) {
        findings.push({
          file,
          line: lineNum,
          category: 'async',
          severity: 'warning',
          message: "Potential missing 'await' on an asynchronous method call. Consider prepending 'await' to ensure completion.",
          hunk_ref: hunk.header
        });
      }
    }

    // --- NULL-SAFETY RULES ---

    // Overuse of null-forgiving operator
    // e.g. "var address = customer!.Address;" or "client!."
    if (/\b\w+!\s*\.\s*\w+/.test(trimmedContent) || /\b\w+!\s*[;,]/.test(trimmedContent)) {
      findings.push({
        file,
        line: lineNum,
        category: 'null-handling',
        severity: 'warning',
        message: "Avoid overusing the null-forgiving operator '!'. Perform actual null validation checks instead of bypassing the C# compiler safety.",
        hunk_ref: hunk.header
      });
    }

    // Assignment and immediate dot-access without null check
    // e.g. "var x = Get(); x.Do();" where x could be null
    // (Checked across consecutive lines in the hunk)
    
    // --- SOLID PRINCIPLES RULES ---

    // Mix of responsibilities: classes with names ending in Manager, Helper, Utility, Common
    if (/\bclass\s+\w*(Manager|Helper|Utility|Utilities|Common)\b/.test(trimmedContent)) {
      const match = trimmedContent.match(/\bclass\s+(\w+)\b/);
      const className = match ? match[1] : 'this class';
      findings.push({
        file,
        line: lineNum,
        category: 'SOLID',
        severity: 'warning',
        message: `The class name '${className}' suggests it might be a God class or utility wrapper violating the Single Responsibility Principle (SRP). Consider splitting it into focused, domain-specific components.`,
        hunk_ref: hunk.header
      });
    }

    // Tight coupling: direct instantiation of major dependencies
    if (/\bnew\s+(HttpClient|DbContext|\w+Service|\w+Repository)\(/.test(trimmedContent)) {
      const match = trimmedContent.match(/\bnew\s+(\w+)\(/);
      const dependency = match ? match[1] : 'this object';
      findings.push({
        file,
        line: lineNum,
        category: 'SOLID',
        severity: 'warning',
        message: `Tight coupling detected: instantiation of '${dependency}' via the 'new' operator. Consider injecting this dependency through the constructor (Dependency Inversion Principle) to improve testability and modularity.`,
        hunk_ref: hunk.header
      });
    }
  }

  return findings;
}

/**
 * LLM reviewer calling Google Gemini API.
 * @param {string} file 
 * @param {object} hunk 
 * @param {Set<number>} validLines 
 * @param {string} apiKey 
 * @returns {Promise<Array<object>>} Findings returned by the LLM
 */
async function reviewHunkLLM(file, hunk, validLines, apiKey) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  
  const additionsList = hunk.additions.map(a => `Line ${a.lineNum}: ${a.content}`).join('\n');
  
  const prompt = `You are an expert C# code reviewer analyzing pull request diffs.
Review the following unified diff hunk in file: "${file}".
Identify any issues related to:
1. SOLID violations (God classes, mixed responsibilities, tight coupling/newing dependencies).
2. Null-safety gaps (missing null checks, unguarded dereferences, overuse of '!').
3. Async/await correctness (async void, blocking Result/Wait(), missing await).

IMPORTANT REQUIREMENTS:
- You MUST only comment on the lines that were added (these are the lines listed in the additions array).
- Do NOT comment on lines not in the additions array.
- Keep the messages concise, action-oriented, and grounded in C# best practices.

File: ${file}
Diff Hunk:
${hunk.header}
${hunk.lines.join('\n')}

Added lines to review:
${additionsList}`;

  const payload = {
    contents: [
      {
        parts: [
          { text: prompt }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            line: { type: "INTEGER", description: "The exact line number from the added lines list where the issue occurs." },
            category: { type: "STRING", enum: ["SOLID", "null-handling", "async"], description: "The classification of the issue." },
            severity: { type: "STRING", enum: ["warning", "error", "info"] },
            message: { type: "STRING", description: "Concise review message explaining the issue and the solution." }
          },
          required: ["line", "category", "severity", "message"]
        }
      }
    }
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const result = await response.json();
  const textContent = result.candidates?.[0]?.content?.parts?.[0]?.text;
  
  if (!textContent) {
    return [];
  }

  let rawFindings;
  try {
    rawFindings = JSON.parse(textContent.trim());
  } catch (parseError) {
    core.warning(`Failed to parse Gemini JSON output: ${textContent}`);
    return [];
  }

  if (!Array.isArray(rawFindings)) {
    return [];
  }

  // Grounding check: Ensure findings only target lines that were actually added
  const groundedFindings = [];
  for (const f of rawFindings) {
    const lineInt = parseInt(f.line, 10);
    if (validLines.has(lineInt)) {
      groundedFindings.push({
        file,
        line: lineInt,
        category: f.category,
        severity: f.severity || 'warning',
        message: f.message,
        hunk_ref: hunk.header
      });
    } else {
      core.info(`Skipping ungrounded LLM finding for ${file} on line ${f.line} (not in additions)`);
    }
  }

  return groundedFindings;
}

module.exports = {
  reviewDiffs,
  reviewHunkStatic
};
