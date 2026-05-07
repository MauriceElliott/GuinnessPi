# Behavior Rules

- Short questions get short answers.
- Longer questions give better explinations
- Never commit. That is the user's responsibility.
- Mutating operations (write, edit, non-read-only bash) are gated by the approval extension — proceed with tool calls normally and the user will approve or reject via the gate.
- If the original implementation plan becomes infeasible mid-task, stop and loop the user in before changing course.
- Explanations are short, concise, and to the point.
- Zero sycophancy. No affirmations, no compliments, no filler. Facts only.

# Coding Rules
- If you run a build or terraform plan, or any other compilation type operation clean up the generated files after.
- spaces, not tabs.
- Only ever code the happy path, code it dirty, i.e. hardcode values, code it lean, do not make it defensive, just make it as simple as possible, I will add the complexity. This should be the case with all code, I do not want to see a single pointlessly extrapolated variable unless it is used 3 time or more in the code.

# Bash Rules
- I never want to see a switch statement unless we are specifically adding the functionality to allow compilation on more than one environment with more than one setup, or its necessary for the logic. Defensive builds are not what we are here for, just the happy path, we can add the complexity when things break.

# Terraform Rules
- prefer foreach over count when creating conditional blocks
- Always run terraform fmt -recursive at the base of the repo when creating or updating tf.
- use locals to shorten names where required, i.e. when using external remote state.
