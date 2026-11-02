/** Conventional Commits, with scopes matching the repo layout. */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        'twitch',
        'zoia',
        'chat',
        'docs',
        'test',
        'adr',
        'ci',
        // Dependabot's own scopes, which it cannot be told to change.
        'deps',
        'deps-dev',
        '',
      ],
    ],
    'header-max-length': [2, 'always', 100],
    // A warning: Dependabot's bodies are tables of URLs, which nobody can reflow.
    'body-max-line-length': [1, 'always', 100],
  },
};
