const assert = require("node:assert/strict");
const test = require("node:test");

const {
  addBusinessDays,
  findMarkerTimestamp,
  handleIntake,
  isBot,
  isExternalAssociation,
} = require("./external-contributions");
const {
  extractPullRequestNumbers,
  findExternalContributors,
  upsertContributorSection,
} = require("./release-contributors");

test("addBusinessDays preserves time and skips weekends", () => {
  assert.equal(
    addBusinessDays("2026-08-07T18:30:00.000Z", 2).toISOString(),
    "2026-08-11T18:30:00.000Z",
  );
  assert.equal(
    addBusinessDays("2026-08-10T18:30:00.000Z", 2).toISOString(),
    "2026-08-12T18:30:00.000Z",
  );
  assert.equal(
    addBusinessDays("2026-08-10T18:30:00.000Z", 5).toISOString(),
    "2026-08-17T18:30:00.000Z",
  );
});

test("isExternalAssociation excludes repository insiders", () => {
  for (const association of ["OWNER", "MEMBER", "COLLABORATOR"]) {
    assert.equal(isExternalAssociation(association), false);
  }
  for (const association of [
    "CONTRIBUTOR",
    "FIRST_TIME_CONTRIBUTOR",
    "FIRST_TIMER",
    "NONE",
  ]) {
    assert.equal(isExternalAssociation(association), true);
  }
});

test("isBot identifies GitHub bot accounts", () => {
  assert.equal(isBot({ login: "dependabot[bot]", type: "Bot" }), true);
  assert.equal(isBot({ login: "renovate[bot]", type: "User" }), true);
  assert.equal(isBot({ login: "octocat", type: "User" }), false);
});

test("findMarkerTimestamp reads the SLA start comment", () => {
  const startedAt = findMarkerTimestamp(
    [
      { body: "No marker" },
      {
        body: "<!-- external-contribution-sla-start:2026-08-11T20:00:00.000Z -->",
      },
    ],
    "external-contribution-sla-start",
  );
  assert.equal(startedAt.toISOString(), "2026-08-11T20:00:00.000Z");
});

test("handleIntake repairs a missing welcome comment on retry", async () => {
  const comments = [];
  const github = {
    paginate: async () => [],
    rest: {
      issues: {
        addLabels: async () => assert.fail("external label already exists"),
        createComment: async ({ body }) => comments.push(body),
        createLabel: async () => {
          const error = new Error("already exists");
          error.status = 422;
          throw error;
        },
        get: async () => ({
          data: { labels: [{ name: "external-contribution" }] },
        }),
        listComments: async () => [],
      },
    },
  };
  const context = {
    payload: {
      issue: {
        author_association: "NONE",
        draft: false,
        number: 42,
        user: { login: "alice", type: "User" },
      },
    },
    repo: { owner: "kubefleet-dev", repo: "kubefleet" },
  };
  const config = {
    slaBusinessDays: 5,
    labels: {
      external: {
        name: "external-contribution",
        color: "0E8A16",
        description: "External contribution",
      },
    },
  };

  await handleIntake({ github, context, config });

  assert.equal(comments.length, 1);
  assert.match(comments[0], /external-contribution-sla-start/);
});

test("extractPullRequestNumbers returns unique pull requests", () => {
  const body = [
    "https://github.com/kubefleet-dev/kubefleet/pull/12",
    "https://github.com/kubefleet-dev/kubefleet/pull/8",
    "https://github.com/kubefleet-dev/kubefleet/pull/12",
  ].join("\n");
  assert.deepEqual(extractPullRequestNumbers(body), [12, 8]);
});

test("upsertContributorSection preserves hand-written release notes", () => {
  const original = [
    "Custom release notes",
    "",
    "<!-- external-contributors:start -->",
    "old content",
    "<!-- external-contributors:end -->",
    "",
    "Manual footer",
  ].join("\n");
  const updated = upsertContributorSection(original, ["alice", "bob"]);

  assert.match(updated, /Custom release notes/);
  assert.match(updated, /Thank you @alice, @bob/);
  assert.doesNotMatch(updated, /old content/);
  assert.match(updated, /Manual footer/);
});

test("findExternalContributors excludes insiders and bots", async () => {
  const pulls = new Map([
    [1, { user: { login: "alice" }, author_association: "CONTRIBUTOR" }],
    [2, { user: { login: "owner" }, author_association: "OWNER" }],
    [3, { user: { login: "dependabot[bot]" }, author_association: "NONE" }],
  ]);
  const github = {
    rest: {
      pulls: {
        get: async ({ pull_number: pullNumber }) => ({
          data: pulls.get(pullNumber),
        }),
      },
    },
  };
  const context = { repo: { owner: "kubefleet-dev", repo: "kubefleet" } };
  const body = [1, 2, 3]
    .map(
      (number) =>
        `https://github.com/kubefleet-dev/kubefleet/pull/${number}`,
    )
    .join("\n");

  assert.deepEqual(
    await findExternalContributors(github, context, body),
    ["alice"],
  );
});
