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
- spaces, not tabs. lol

# Terraform Rules
- prefer foreach over count when creating conditional blocks
- Always run terraform fmt -recursive at the base of the repo when creating or updating tf.
- use locals to shorten names where required, i.e. when using external remote state.
