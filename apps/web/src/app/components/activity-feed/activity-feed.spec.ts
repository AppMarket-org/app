import { describeGroup } from './activity-feed';

describe('activity wording', () => {
  it('reads like GitHub', () => {
    expect(describeGroup('commit', 23, 3)).toBe('Created 23 commits in 3 repos');
    expect(describeGroup('commit', 1, 1)).toBe('Created 1 commit in 1 repo');
    expect(describeGroup('repo', 2, 2)).toBe('Created 2 repos');
    expect(describeGroup('version', 1, 1)).toBe('Submitted 1 version');
    expect(describeGroup('release', 2, 1)).toBe('Uploaded 2 releases');
    expect(describeGroup('checkpoint', 10, 2)).toBe('Recorded 10 checkpoints in 2 repos');
  });
});
