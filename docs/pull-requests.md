# Pull requests

A pull request proposes a branch for another branch of a repo. The branch can come from:

- the repo itself;
- a fork of it, made with **Use this template**;
- an agent session's fork.

## Who can do what

- **See:** anyone who can see the repo. On an unpublished repo, only its owners and members.
- **Open:** anyone who can push to the source: the repo's owners and members for its own
  branches, or the fork's owners for a fork.
- **Edit, close, reopen:** the author, and the repo's owners and members.
- **Merge:** the repo's owners and members.

Titles and descriptions have secrets redacted, as checkpoints do. Each repo numbers its pull
requests from 1. Only one pull request can be open for the same source branch and target branch.
The head commit follows the source branch while the pull request is open.

## Reviews and comments

- **Comments:** anyone signed in who can see the repo can comment on the conversation, or on a
  line of the diff (file, line, and the old or new side). Authors edit and delete their own
  comments; the repo's owners and members can delete any.
- **Reviews:** a review comments, approves or requests changes, and can carry line comments.
  Approvals and requests for changes count only from the repo's owners and members, and never
  from the author. Each counting reviewer's latest review decides, and a request for changes
  wins over approvals.
- **Merge rule:** a request for changes blocks merging. With **require approval** on
  (`PUT /api/repos/:owner/:repo/pull-settings { requireApproval }`), merging also needs an
  approval. The pull request shows why it cannot be merged (`mergeBlocked`).
- **Email** (Settings → Email → Pull requests):
  - the repo's owners hear about new pull requests;
  - the author, commenters and reviewers hear about comments and reviews;
  - nobody is emailed about their own actions;
  - each email has a one-click unsubscribe.

## Merging

Merging uses the same steps as the agent board (#238):
1. The branch is rebased onto the target branch in a fresh container, and checkpoint notes follow
   the commits.
2. The checks and conformance run on the rebased commit. Only rules the change newly breaks block
   it.
3. The target branch fast-forwards to exactly the commit that was checked.

A conflict names the files. If the target branch moved during the checks, nothing is pushed, and
merging again starts over. A repo with auto deploy redeploys after the merge.

## API

| Method | Path | |
| --- | --- | --- |
| GET | `/api/repos/:owner/:repo/pulls?state=open\|closed\|merged\|all` | List, with counts per state |
| POST | `/api/repos/:owner/:repo/pulls` | `{ title, body?, source?: "owner/fork", sourceBranch, targetBranch? }` |
| GET, PATCH | `/api/repos/:owner/:repo/pulls/:number` | PATCH takes `title`, `body`, `state` (open or closed) |
| POST | `/api/repos/:owner/:repo/pulls/:number/merge` | Starts the merge; follow it in `merge` on the pull request |
| GET | `/api/repos/:owner/:repo/pulls/:number/files` | The pull request's commits and files changed (added, modified, deleted, with line counts; binary and files over 512 KB flagged) |
| GET | `/api/repos/:owner/:repo/pulls/:number/diff?path=` | One file's hunks, with 3 lines of context |

The diff of an open pull request compares the head with its merge base on the target branch, as
`git diff target...source` does, so changes made on the target meanwhile are not shown. Once
merged, it shows what landed.
| GET, POST | `/api/repos/:owner/:repo/pulls/:number/comments` | The conversation (comments and reviews); POST `{ body, path?, line?, side? }` |
| PATCH, DELETE | `/api/repos/:owner/:repo/pulls/:number/comments/:id` | Edit your comment; delete yours (owners and members: any) |
| POST | `/api/repos/:owner/:repo/pulls/:number/reviews` | `{ event: comment \| approve \| request_changes, body?, comments?: [{ path, line, side, body }] }` |
