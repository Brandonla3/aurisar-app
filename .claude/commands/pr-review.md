# PR Review

Review the Pull Request that is being referenced or worked on in this chat session.

## Instructions

1. **Identify the PR**: Determine which Pull Request is being referenced in the current conversation. This could be:
   - A PR number or URL explicitly mentioned by the user
   - The PR associated with the current working branch
   - If no PR is identifiable, check the current git branch and look for an open PR targeting it

2. **Gather PR Context**: Collect the following information about the PR:
   - PR title, description, and author
   - The base branch and head branch
   - The full diff of all changed files
   - Any existing review comments or discussions
   - CI/check status if available

3. **Review the Code Changes**: Analyze every file changed in the PR. For each file, evaluate:

   ### Correctness
   - Logic errors, off-by-one mistakes, race conditions
   - Incorrect assumptions about data types or nullability
   - Missing error handling or edge cases
   - Broken control flow (unreachable code, missing returns)

   ### Security
   - Injection vulnerabilities (SQL, XSS, command injection)
   - Exposed secrets, credentials, or sensitive data
   - Improper authentication or authorization checks
   - Unsafe deserialization or input handling

   ### Performance
   - Unnecessary re-renders, redundant computations, or N+1 queries
   - Missing indexes, unbounded queries, or memory leaks
   - Blocking operations that should be async

   ### Code Quality
   - Readability and maintainability
   - Consistency with existing codebase patterns and conventions
   - Proper naming, clear intent, appropriate abstractions
   - Dead code, unused imports, or unnecessary complexity

   ### Testing
   - Are new features or bug fixes covered by tests?
   - Are edge cases tested?
   - Do existing tests still pass with these changes?

4. **Read the actual source files** when needed for additional context. Don't rely solely on the diff - understand the surrounding code to assess whether changes integrate well.

5. **Produce a Structured Review**: Output your review in this format:

   ### PR Summary
   A brief 2-3 sentence summary of what the PR does and its purpose.

   ### Review Verdict
   One of: **Approve**, **Request Changes**, or **Comment**
   With a one-line rationale.

   ### Findings
   Group findings by severity:
   - **Critical**: Must fix before merge (bugs, security issues, data loss risks)
   - **Important**: Should fix before merge (significant code quality, performance, or correctness concerns)
   - **Suggestion**: Nice to have improvements (style, minor refactors, optional optimizations)
   - **Praise**: Call out things done well (good patterns, thorough tests, clean design)

   For each finding, include:
   - The file path and line number(s)
   - A clear description of the issue
   - A suggested fix or improvement (with code snippet when helpful)

   ### Testing Assessment
   Comment on test coverage for the changes - what's covered, what's missing.

   ### Overall Notes
   Any high-level architectural observations, questions for the author, or broader concerns.

## Guidelines

- Be thorough but fair - distinguish real issues from style preferences
- Provide actionable feedback with concrete suggestions
- Acknowledge good work, not just problems
- Consider the PR in context of the broader codebase
- If the diff is very large, prioritize reviewing the most critical files first (business logic, security-sensitive code, public APIs)
- Do NOT leave review comments on the PR itself unless explicitly asked - just output the review to the chat
